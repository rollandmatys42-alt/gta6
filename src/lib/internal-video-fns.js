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
    return db.InternalVideoAsset.update(asset.id, { status: "archived" });
  });
