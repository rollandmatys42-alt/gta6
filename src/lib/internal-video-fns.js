import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { issueStorageUploadUrl, listStorageConnections, recordStorageUsage } from "@/lib/storage-fns";

function requireAdmin(context) {
  if (context.user?.role !== "admin") {
    throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
  }
}

const rightsStatuses = ["pending", "authorised", "restricted", "not_applicable"];

export const listInternalVideoAssets = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
    status: z.enum(["stored", "processing", "ready", "archived"]).optional(),
    assetType: z.enum(["source", "clip", "derivative"]).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const filter = {};
    if (data.status) filter.status = data.status;
    if (data.assetType) filter.asset_type = data.assetType;
    const assets = await db.InternalVideoAsset.filter(filter, "-created_date", data.limit, data.offset);
    return { assets, nextOffset: data.offset + assets.length, hasMore: assets.length === data.limit };
  });

export const listInternalVideoJobs = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    return context.getBase44().asServiceRole.entities.InternalVideoJob.list("-created_date", data.limit, 0);
  });

export const enqueueInternalVideoJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    assetId: z.string().min(1).max(128),
    jobType: z.enum(["analyse", "transcribe"]),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || asset.status === "archived") {
      throw Object.assign(new Error("The source asset is unavailable."), { status: 404, code: "SOURCE_ASSET_NOT_FOUND" });
    }
    if (!["authorised", "not_applicable"].includes(asset.rights_status)) {
      throw Object.assign(new Error("Processing is blocked until usage rights are verified and recorded for this asset."), { status: 409, code: "VIDEO_RIGHTS_NOT_CLEARED" });
    }
    const active = await db.InternalVideoJob.filter({ asset_id: asset.id, job_type: data.jobType }, "-created_date", 10, 0);
    if (active.some(job => ["queued", "processing"].includes(job.status))) {
      throw Object.assign(new Error("A matching processing job is already queued or running for this asset."), { status: 409, code: "VIDEO_JOB_ALREADY_ACTIVE" });
    }
    const job = await db.InternalVideoJob.create({
      asset_id: asset.id,
      job_type: data.jobType,
      status: "queued",
      progress_percent: 0,
      stage: "Waiting for an available VICEHUB worker",
      attempts: 0,
      idempotency_key: crypto.randomUUID(),
      created_by: context.user.id,
    });
    return { job, workerConfigured: false, message: "Job saved to the queue. It will start when the authenticated VICEHUB worker is connected." };
  });

export const cancelInternalVideoJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ jobId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const job = await db.InternalVideoJob.get(data.jobId).catch(() => null);
    if (!job) throw Object.assign(new Error("Processing job not found."), { status: 404, code: "VIDEO_JOB_NOT_FOUND" });
    if (job.status !== "queued") {
      throw Object.assign(new Error("Only queued jobs can be cancelled from the library. A running worker must finish or report failure."), { status: 409, code: "VIDEO_JOB_NOT_CANCELLABLE" });
    }
    return db.InternalVideoJob.update(job.id, {
      status: "cancelled",
      stage: "Cancelled by administrator",
      completed_at: new Date().toISOString(),
    });
  });

export const createInternalVideoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    fileName: z.string().trim().min(1).max(180),
    contentType: z.enum(["video/mp4", "video/quicktime"]),
    fileSize: z.number().int().positive(),
    storageConnectionId: z.string().min(1).max(128).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const upload = await issueStorageUploadUrl({
      entities: db,
      contentType: data.contentType,
      fileSize: data.fileSize,
      assetVariant: "internal-library",
      connectionId: data.storageConnectionId,
    });
    if (!upload) {
      throw Object.assign(new Error("No verified S3-compatible storage account is connected. Open Video administration and connect a private storage account first."), { status: 503, code: "INTERNAL_STORAGE_NOT_READY" });
    }
    return { ...upload, contentType: data.contentType, originalFilename: data.fileName };
  });

export const createInternalVideoAsset = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    title: z.string().trim().min(2).max(180),
    description: z.string().max(5000).optional(),
    assetType: z.enum(["source", "clip", "derivative"]).default("source"),
    category: z.string().trim().max(80).optional(),
    language: z.string().trim().max(12).default("en"),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    sourceUrl: z.string().url().max(1000).optional(),
    rightsStatus: z.enum(rightsStatuses).default("pending"),
    rightsEvidenceUrl: z.string().url().max(1000).optional(),
    storageKey: z.string().min(1).max(600).refine(value => value.startsWith("videos/internal-library/") && !value.split("/").includes("..") && (value.endsWith(".mp4") || value.endsWith(".mov"))),
    storageConnectionId: z.string().min(1).max(128),
    originalFilename: z.string().trim().min(1).max(180),
    mimeType: z.enum(["video/mp4", "video/quicktime"]),
    fileSizeBytes: z.number().int().positive(),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
    width: z.number().int().min(0).max(16384).optional(),
    height: z.number().int().min(0).max(16384).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    if (data.rightsStatus === "authorised" && !data.rightsEvidenceUrl) {
      throw Object.assign(new Error("Add a URL to written rights evidence before marking this asset authorised."), { status: 400, code: "RIGHTS_EVIDENCE_REQUIRED" });
    }
    if (data.sourceUrl && !["http:", "https:"].includes(new URL(data.sourceUrl).protocol)) {
      throw Object.assign(new Error("Source references must use HTTP or HTTPS."), { status: 400, code: "INVALID_SOURCE_URL" });
    }
    const db = context.getBase44().asServiceRole.entities;
    const connections = await listStorageConnections(db);
    const connection = connections.find(item => item.id === data.storageConnectionId);
    if (!connection || !connection.enabled || !connection.verifiedAt) {
      throw Object.assign(new Error("The selected storage account is no longer enabled and verified."), { status: 409, code: "STORAGE_CONNECTION_NOT_READY" });
    }
    const asset = await db.InternalVideoAsset.create({
      title: data.title,
      description: data.description || "",
      asset_type: data.assetType,
      status: "stored",
      category: data.category || "",
      language: data.language || "en",
      tags: data.tags,
      ...(data.sourceUrl ? { source_url: data.sourceUrl } : {}),
      rights_status: data.rightsStatus,
      ...(data.rightsEvidenceUrl ? { rights_evidence_url: data.rightsEvidenceUrl } : {}),
      storage_key: data.storageKey,
      storage_connection_id: data.storageConnectionId,
      original_filename: data.originalFilename,
      mime_type: data.mimeType,
      file_size_bytes: data.fileSizeBytes,
      ...(data.durationSeconds !== undefined ? { duration_seconds: data.durationSeconds } : {}),
      ...(data.width !== undefined ? { width: data.width } : {}),
      ...(data.height !== undefined ? { height: data.height } : {}),
      created_by: context.user.id,
    });
    let usageRecorded = true;
    try {
      await recordStorageUsage({ entities: db, connectionId: data.storageConnectionId, bytes: data.fileSizeBytes });
    } catch {
      usageRecorded = false;
    }
    return { ...asset, usageRecorded };
  });

export const archiveInternalVideoAsset = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ assetId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset) throw Object.assign(new Error("Internal video asset not found."), { status: 404, code: "ASSET_NOT_FOUND" });
    if (asset.status === "archived") return asset;
    const activeJobs = await db.InternalVideoJob.filter({ asset_id: asset.id }, "-created_date", 50, 0);
    if (activeJobs.some(job => ["queued", "processing"].includes(job.status))) {
      throw Object.assign(new Error("Cancel or finish the active processing jobs before archiving this asset."), { status: 409, code: "ASSET_HAS_ACTIVE_JOBS" });
    }
    return db.InternalVideoAsset.update(asset.id, { status: "archived" });
  });
