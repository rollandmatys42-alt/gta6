import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import {
  createGoogleDriveResumableUpload,
  getGoogleDriveAccessToken,
  getGoogleDriveFileMetadata,
  listGoogleDriveVideoFiles as fetchGoogleDriveVideoFiles,
} from "@/lib/google-drive-api";
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

export const listGoogleDriveVideoFiles = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({
    query: z.string().trim().max(100).default(""),
    pageToken: z.string().max(2000).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const result = await fetchGoogleDriveVideoFiles(context.getBase44(), data);
    return { ...result, connected: true };
  });

export const importGoogleDriveVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    fileId: z.string().trim().min(5).max(512),
    rightsStatus: z.enum(rightsStatuses).default("pending"),
    rightsEvidenceUrl: z.string().url().max(1000).optional(),
    category: z.string().trim().max(80).optional(),
    language: z.string().trim().max(12).default("en"),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    if (data.rightsStatus === "authorised" && !data.rightsEvidenceUrl) {
      throw Object.assign(new Error("Written rights evidence is required before marking this Drive video authorised."), { status: 400, code: "RIGHTS_EVIDENCE_REQUIRED" });
    }
    const db = context.getBase44().asServiceRole.entities;
    const existing = await db.InternalVideoAsset.filter({ google_drive_file_id: data.fileId }, "-created_date", 1, 0);
    if (existing.length) return { asset: existing[0], alreadyImported: true };
    const file = await getGoogleDriveFileMetadata(context.getBase44(), data.fileId);
    if (!String(file.mimeType || "").startsWith("video/")) {
      throw Object.assign(new Error("Only video files stored in Google Drive can be imported."), { status: 415, code: "DRIVE_FILE_NOT_VIDEO" });
    }
    if (file.capabilities?.canDownload === false) {
      throw Object.assign(new Error("Google Drive reports that this video cannot be downloaded by the connected account."), { status: 403, code: "DRIVE_DOWNLOAD_NOT_ALLOWED" });
    }
    const fileSize = Number(file.size || 0);
    const asset = await db.InternalVideoAsset.create({
      title: String(file.name || "Untitled Drive video").slice(0, 180),
      description: String(file.description || "").slice(0, 5000),
      asset_type: "source",
      status: "stored",
      category: data.category || "",
      language: data.language || "en",
      tags: [],
      rights_status: data.rightsStatus,
      ...(data.rightsEvidenceUrl ? { rights_evidence_url: data.rightsEvidenceUrl } : {}),
      storage_provider: "google_drive",
      google_drive_file_id: file.id,
      ...(Array.isArray(file.parents) && file.parents[0] ? { google_drive_parent_id: file.parents[0] } : {}),
      ...(file.webViewLink ? { google_drive_web_view_link: file.webViewLink } : {}),
      original_filename: String(file.name || "video").slice(0, 180),
      mime_type: file.mimeType,
      file_size_bytes: Number.isFinite(fileSize) ? fileSize : 0,
      created_by: context.user.id,
    });
    return { asset, alreadyImported: false };
  });

export const enqueueInternalVideoJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    assetId: z.string().min(1).max(128),
    jobType: z.enum(["analyse", "transcribe", "cut_clip"]),
    startSeconds: z.number().min(0).max(86400).optional(),
    endSeconds: z.number().min(0).max(86400).optional(),
    outputTitle: z.string().trim().min(2).max(180).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || asset.status === "archived") {
      throw Object.assign(new Error("The source asset is unavailable."), { status: 404, code: "SOURCE_ASSET_NOT_FOUND" });
    }
    if (![ "authorised", "not_applicable" ].includes(asset.rights_status)) {
      throw Object.assign(new Error("Processing is blocked until usage rights are verified and recorded for this asset."), { status: 409, code: "VIDEO_RIGHTS_NOT_CLEARED" });
    }
    let cutDetails = {};
    if (data.jobType === "cut_clip") {
      const start = data.startSeconds;
      const end = data.endSeconds;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 900) {
        throw Object.assign(new Error("A clip must have a valid start and end time and cannot exceed 15 minutes."), { status: 400, code: "INVALID_CLIP_RANGE" });
      }
      if (!Number(asset.duration_seconds) || end > Number(asset.duration_seconds) + 0.05) {
        throw Object.assign(new Error("Analyse this source video first so VICEHUB knows its duration, then choose a clip range within the source."), { status: 409, code: "SOURCE_DURATION_REQUIRED" });
      }
      await getGoogleDriveAccessToken(context.getBase44());
      cutDetails = {
        start_seconds: start,
        end_seconds: end,
        output_title: data.outputTitle || (asset.title + " - clip"),
        ...(asset.google_drive_parent_id ? { output_drive_parent_id: asset.google_drive_parent_id } : {}),
      };
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
      stage: data.jobType === "cut_clip" ? "Waiting for the FFmpeg worker" : "Waiting for an available VICEHUB worker",
      attempts: 0,
      idempotency_key: crypto.randomUUID(),
      created_by: context.user.id,
      ...cutDetails,
    });
    return { job, workerConfigured: false, message: data.jobType === "cut_clip"
      ? "Clip export added to the queue. It will run when the authenticated video worker is deployed."
      : "Job saved to the queue. It will start when the authenticated VICEHUB worker is connected." };
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
      storage_provider: "s3",
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

export const reviewInternalVideoAsset = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    assetId: z.string().min(1).max(128),
    reviewStatus: z.enum(["needs_review", "approved", "rejected"]).optional(),
    publicVideoStatus: z.enum(["draft", "published"]).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || asset.asset_type !== "clip" || asset.status !== "ready") {
      throw Object.assign(new Error("Only completed clip assets can be reviewed or published."), { status: 409, code: "CLIP_NOT_READY" });
    }
    const reviewStatus = data.reviewStatus || asset.review_status || "needs_review";
    const publicVideoStatus = data.publicVideoStatus || asset.public_video_status || "draft";
    if (publicVideoStatus === "published" && (!["approved"].includes(reviewStatus) || !["authorised", "not_applicable"].includes(asset.rights_status))) {
      throw Object.assign(new Error("Approve the clip and confirm its rights before publishing it to the client library."), { status: 409, code: "CLIP_NOT_APPROVED" });
    }
    return db.InternalVideoAsset.update(asset.id, {
      review_status: reviewStatus,
      public_video_status: publicVideoStatus,
      ...(publicVideoStatus === "published" ? { public_published_at: new Date().toISOString() } : {}),
    });
  });

const INTERNAL_CLIP_DOWNLOAD_TTL = 120;

export const listPublicInternalClips = createServerFn({ method: "GET" })
  .validator(z.object({
    search: z.string().trim().max(100).optional(),
    category: z.string().trim().max(80).optional(),
    language: z.string().trim().max(12).optional(),
    country: z.string().trim().length(2).optional(),
    limit: z.number().int().min(1).max(48).default(24),
    offset: z.number().int().min(0).max(100000).default(0),
  }))
  .handler(async ({ data, context }) => {
    const db = context.getBase44().asServiceRole.entities;
    const filter = {
      asset_type: "clip", status: "ready", review_status: "approved",
      public_video_status: "published", rights_status: { $in: ["authorised", "not_applicable"] },
    };
    if (data.category) filter.category = data.category;
    if (data.language) filter.language = data.language;
    if (data.country) filter.target_countries = data.country.toUpperCase();
    const rows = await db.InternalVideoAsset.filter(filter, "-public_published_at", 500, 0);
    const term = String(data.search || "").toLowerCase();
    const filtered = term ? rows.filter(asset =>
      [asset.title, asset.description, asset.topic, asset.category, asset.language, ...(asset.tags || [])]
        .join(" ").toLowerCase().includes(term)
    ) : rows;
    const page = filtered.slice(data.offset, data.offset + data.limit);
    return {
      assets: page.map(asset => ({
        id: asset.id, title: asset.title, description: asset.description || "",
        category: asset.category || "Other", topic: asset.topic || "",
        language: asset.detected_language || asset.language || "und",
        target_countries: Array.isArray(asset.target_countries) ? asset.target_countries : [],
        tags: Array.isArray(asset.tags) ? asset.tags : [],
        duration_seconds: Number(asset.duration_seconds || 0),
        thumbnail_url: asset.thumbnail_url || "",
        viral_potential_score: Number.isInteger(asset.viral_potential_score) ? asset.viral_potential_score : null,
        public_published_at: asset.public_published_at || asset.created_date || null,
      })),
      nextOffset: data.offset + page.length,
      hasMore: data.offset + page.length < filtered.length,
    };
  });

export const requestInternalClipDownload = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ assetId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const db = context.getBase44().asServiceRole.entities;
    const user = context.user;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || asset.asset_type !== "clip" || asset.status !== "ready" ||
        asset.review_status !== "approved" || asset.public_video_status !== "published" ||
        !["authorised", "not_applicable"].includes(asset.rights_status) || !asset.google_drive_file_id) {
      throw Object.assign(new Error("This clip is not available for download."), { status: 404, code: "CLIP_NOT_AVAILABLE" });
    }
    const subscriptions = await db.UserSubscription.filter({ user_id: user.id }, "-created_date", 1, 0);
    const subscription = subscriptions[0];
    const tier = subscription?.tier_code || "free";
    const active = subscription?.status === "active" ||
      (subscription?.status === "past_due" && subscription?.grace_period_ends_at && new Date(subscription.grace_period_ends_at) > new Date());
    if (!active || tier === "free") {
      throw Object.assign(new Error("An active paid subscription is required to download clips from the VICEHUB library."), { status: 403, code: "PAID_SUBSCRIPTION_REQUIRED" });
    }
    const plans = await db.SubscriptionPlan.filter(
      { tier_code: tier, currency: subscription?.currency || "GBP", status: "active" }, "-created_date", 1, 0,
    );
    const plan = plans[0];
    if (!plan) throw Object.assign(new Error("Your subscription plan is not configured."), { status: 403, code: "PLAN_NOT_CONFIGURED" });
    const limit = Number(plan.monthly_download_limit || 0);
    if (!Number.isInteger(limit) || limit < 1) {
      throw Object.assign(new Error("Your plan does not include clip downloads."), { status: 403, code: "DOWNLOADS_NOT_INCLUDED" });
    }
    if (!plan.clean_downloads) {
      throw Object.assign(new Error("Clean clip downloads are not included in your current plan."), { status: 403, code: "CLEAN_DOWNLOADS_NOT_INCLUDED" });
    }
    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7);
    let quotas = await db.DownloadQuota.filter({ user_id: user.id, month_key: monthKey }, "-created_date", 2, 0);
    let quota = quotas[0];
    if (!quota) quota = await db.DownloadQuota.create({ user_id: user.id, month_key: monthKey, downloads_used: 0, downloads_limit: limit, tier_code: tier });
    const reservation = await db.DownloadQuota.updateMany(
      { id: quota.id, downloads_used: { $lt: limit } },
      { $inc: { downloads_used: 1 }, $set: { downloads_limit: limit, tier_code: tier, last_download_at: now.toISOString() } },
    );
    if (!reservation?.updated) throw Object.assign(new Error("You have reached your monthly clip download allowance."), { status: 429, code: "MONTHLY_DOWNLOAD_LIMIT_REACHED", limit });
    try {
      const event = await db.DownloadEvent.create({
        user_id: user.id, video_id: asset.id, month_key: monthKey,
        tier_code: tier, watermark_applied: false, status: "signed",
        delivery_expires_at: new Date(now.getTime() + INTERNAL_CLIP_DOWNLOAD_TTL * 1000).toISOString(),
      });
      return {
        downloadUrl: "/api/internal-video-download/" + encodeURIComponent(asset.id),
        expiresInSeconds: INTERNAL_CLIP_DOWNLOAD_TTL,
        downloadEventId: event.id,
        downloadsLimit: limit,
        downloadsUsed: Number(quota.downloads_used || 0) + 1,
        downloadsRemaining: Math.max(0, limit - Number(quota.downloads_used || 0) - 1),
      };
    } catch (error) {
      await db.DownloadQuota.updateMany({ id: quota.id }, { $inc: { downloads_used: -1 } }).catch(() => null);
      throw error;
    }
  });
