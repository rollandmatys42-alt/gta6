import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import {
  getGoogleDriveFileMetadata,
  listGoogleDriveFolders as fetchGoogleDriveFolders,
  listGoogleDriveVideoFiles as fetchGoogleDriveVideoFiles,
  ensureGoogleDriveLibraryFolders as createGoogleDriveLibraryFolders,
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

export const listGoogleDriveFolders = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ parentId: z.string().min(1).max(512).default("root") }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    return fetchGoogleDriveFolders(context.getBase44(), data);
  });

export const ensureGoogleDriveLibraryFolders = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    requireAdmin(context);
    return { folders: await createGoogleDriveLibraryFolders(context.getBase44()) };
  });

export const listGoogleDriveVideoFiles = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({
    query: z.string().trim().max(100).default(""),
    pageToken: z.string().max(2000).optional(),
    parentId: z.string().max(512).optional(),
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
      status: "ready",
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

export const updateInternalVideoRights = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    assetId: z.string().min(1).max(128),
    rightsStatus: z.enum(rightsStatuses),
    rightsEvidenceUrl: z.string().url().max(1000).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    if (data.rightsStatus === "authorised" && !data.rightsEvidenceUrl) {
      throw Object.assign(new Error("Written rights evidence is required before marking this video authorised."), { status: 400, code: "RIGHTS_EVIDENCE_REQUIRED" });
    }
    const db = context.getBase44().asServiceRole.entities;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || !(asset.google_drive_file_id || asset.storage_url || asset.source_url)) {
      throw Object.assign(new Error("Video storage source not found."), { status: 404, code: "VIDEO_ASSET_NOT_FOUND" });
    }
    return db.InternalVideoAsset.update(asset.id, {
      rights_status: data.rightsStatus,
      ...(data.rightsEvidenceUrl ? { rights_evidence_url: data.rightsEvidenceUrl } : {}),
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
    if (!asset || asset.status !== "ready") {
      throw Object.assign(new Error("Only ready-made videos can be reviewed or published."), { status: 409, code: "VIDEO_NOT_READY" });
    }
    const reviewStatus = data.reviewStatus || asset.review_status || "needs_review";
    const publicVideoStatus = data.publicVideoStatus || asset.public_video_status || "draft";
    if (publicVideoStatus === "published" && (!["approved"].includes(reviewStatus) || !["authorised", "not_applicable"].includes(asset.rights_status))) {
      throw Object.assign(new Error("Approve the video and confirm its rights before publishing it to the client library."), { status: 409, code: "VIDEO_NOT_APPROVED" });
    }
    return db.InternalVideoAsset.update(asset.id, {
      review_status: reviewStatus,
      public_video_status: publicVideoStatus,
      ...(publicVideoStatus === "published" ? { public_published_at: new Date().toISOString() } : {}),
    });
  });

const INTERNAL_CLIP_DOWNLOAD_TTL = 120;

export const setInternalClipEditorial = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    assetId: z.string().min(1).max(128),
    isFeatured: z.boolean().optional(),
    isFavourite: z.boolean().optional(),
  }).refine(data => data.isFeatured !== undefined || data.isFavourite !== undefined))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || asset.status !== "ready" ||
        asset.review_status !== "approved" || asset.public_video_status !== "published" ||
        !["authorised", "not_applicable"].includes(asset.rights_status)) {
      throw Object.assign(new Error("Only approved, rights-cleared and published videos can be placed in editorial collections."), { status: 409, code: "VIDEO_NOT_PUBLISHABLE" });
    }
    const patch = {};
    if (data.isFeatured !== undefined) patch.is_featured = data.isFeatured;
    if (data.isFavourite !== undefined) patch.is_favourite = data.isFavourite;
    return db.InternalVideoAsset.update(asset.id, patch);
  });

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
      asset_type: "source", status: "ready", review_status: "approved",
      public_video_status: "published", rights_status: { $in: ["authorised", "not_applicable"] },
    };
    const [rows, downloadEvents] = await Promise.all([
      db.InternalVideoAsset.filter(filter, "-public_published_at", 5000, 0),
      db.DownloadEvent.filter({ status: "delivered" }, "-created_date", 5000, 0),
    ]);
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400000;
    const thirtyDaysAgo = now - 30 * 86400000;
    const counts7d = new Map();
    const counts30d = new Map();
    for (const event of downloadEvents) {
      const when = new Date(event.created_date || 0).getTime();
      if (!Number.isFinite(when) || !event.video_id) continue;
      if (when >= sevenDaysAgo) counts7d.set(event.video_id, (counts7d.get(event.video_id) || 0) + 1);
      if (when >= thirtyDaysAgo) counts30d.set(event.video_id, (counts30d.get(event.video_id) || 0) + 1);
    }
    const toPublic = asset => ({
      id: asset.id, title: asset.title, description: asset.description || "",
      category: asset.category || "Other", topic: asset.topic || "",
      language: asset.detected_language || asset.language || "und",
      target_countries: Array.isArray(asset.target_countries) ? asset.target_countries : [],
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      editorial_tags: (() => {
        const score = Number.isInteger(asset.viral_potential_score) ? asset.viral_potential_score : null;
        const published = new Date(asset.public_published_at || asset.created_date || 0).getTime();
        const tags = [];
        if (Number.isFinite(published) && published > 0 && now - published <= 7 * 86400000) tags.push("New");
        if (score !== null && score >= 80) tags.push("High viral potential");
        if (score !== null && score >= 90) tags.push("Top video · editorial score ≥90");
        return tags;
      })(),
      duration_seconds: Number(asset.duration_seconds || 0),
      thumbnail_url: asset.thumbnail_url || "",
      preview_url: "/api/internal-video-preview/" + encodeURIComponent(asset.id),
      viral_potential_score: Number.isInteger(asset.viral_potential_score) ? asset.viral_potential_score : null,
      public_published_at: asset.public_published_at || asset.created_date || null,
      download_count_7d: counts7d.get(asset.id) || 0,
      download_count_30d: counts30d.get(asset.id) || 0,
      is_featured: !!asset.is_featured,
      is_favourite: !!asset.is_favourite,
    });
    const all = rows.filter(asset =>
      (asset.storage_provider === "google_drive" && (asset.preview_drive_file_id || asset.google_drive_file_id)) ||
      (asset.storage_key && asset.storage_connection_id)
    ).map(toPublic);
    const filteredByCategory = data.category ? all.filter(x => x.category === data.category) : all;
    const filteredByLanguage = data.language ? filteredByCategory.filter(x => x.language === data.language) : filteredByCategory;
    const filteredByCountry = data.country ? filteredByLanguage.filter(x => x.target_countries.includes(data.country.toUpperCase())) : filteredByLanguage;
    const term = String(data.search || "").toLowerCase();
    const filtered = term ? filteredByCountry.filter(asset =>
      [asset.title, asset.description, asset.topic, asset.category, asset.language, ...(asset.tags || [])]
        .join(" ").toLowerCase().includes(term)
    ) : filteredByCountry;
    const page = filtered.slice(data.offset, data.offset + data.limit);
    const mostDownloaded = [...all].filter(x => x.download_count_30d > 0)
      .sort((a,b) => b.download_count_30d-a.download_count_30d || new Date(b.public_published_at)-new Date(a.public_published_at)).slice(0,8);
    const videoOfWeek = [...all].filter(x => x.download_count_7d > 0)
      .sort((a,b) => b.download_count_7d-a.download_count_7d || new Date(b.public_published_at)-new Date(a.public_published_at))[0] || null;
    const featured = all.filter(x => x.is_featured).sort((a,b) => new Date(b.public_published_at)-new Date(a.public_published_at)).slice(0,4);
    const favourites = all.filter(x => x.is_favourite).sort((a,b) => new Date(b.public_published_at)-new Date(a.public_published_at)).slice(0,8);
    return {
      assets: page,
      collections: { featured, favourites, mostDownloaded, videoOfWeek },
      nextOffset: data.offset + page.length,
      hasMore: data.offset + page.length < filtered.length,
      totalPublished: all.length,
      downloadMetricsWindowDays: 30,
    };
  });

export const getInternalClipDownloadAccess = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const db = context.getBase44().asServiceRole.entities;
    const subscriptions = await db.UserSubscription.filter({ user_id: context.user.id }, "-created_date", 1, 0);
    const subscription = subscriptions[0];
    const tier = subscription?.tier_code || "free";
    const active = subscription?.status === "active" ||
      (subscription?.status === "past_due" && subscription?.grace_period_ends_at && new Date(subscription.grace_period_ends_at) > new Date());
    if (!active || tier === "free") return { canDownload: false, reason: "paid_subscription_required" };
    const plans = await db.SubscriptionPlan.filter(
      { tier_code: tier, currency: subscription?.currency || "GBP", status: "active" }, "-created_date", 1, 0,
    );
    const plan = plans[0];
    if (!plan) return { canDownload: false, reason: "plan_not_configured" };
    const limit = Number(plan.monthly_download_limit || 0);
    if (!Number.isInteger(limit) || limit < 1) return { canDownload: false, reason: "downloads_not_included" };
    if (!plan.clean_downloads) return { canDownload: false, reason: "clean_downloads_not_included" };
    const monthKey = new Date().toISOString().slice(0, 7);
    const quotas = await db.DownloadQuota.filter({ user_id: context.user.id, month_key: monthKey }, "-created_date", 1, 0);
    const used = Number(quotas[0]?.downloads_used || 0);
    const remaining = Math.max(0, limit - used);
    return { canDownload: remaining > 0, reason: remaining > 0 ? null : "limit_reached", tier, downloadsLimit: limit, downloadsUsed: used, downloadsRemaining: remaining };
  });

export const requestInternalClipDownload = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ assetId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const db = context.getBase44().asServiceRole.entities;
    const user = context.user;
    const asset = await db.InternalVideoAsset.get(data.assetId).catch(() => null);
    if (!asset || asset.status !== "ready" ||
        asset.review_status !== "approved" || asset.public_video_status !== "published" ||
        !["authorised", "not_applicable"].includes(asset.rights_status) ||
        !((asset.storage_provider === "google_drive" && asset.google_drive_file_id) || (asset.storage_key && asset.storage_connection_id))) {
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


export const listVideoStorageSources = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    requireAdmin(context);
    return context.getBase44().asServiceRole.entities.VideoStorageSource.list("-created_date", 100, 0);
  });

export const createVideoStorageSource = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    name: z.string().trim().min(2).max(120),
    provider: z.enum(["google_drive", "mega", "onedrive", "dropbox", "direct_url"]),
    marketCountry: z.string().trim().regex(/^[A-Za-z]{2}$/),
    folderUrl: z.string().trim().url().max(1500).optional(),
    folderId: z.string().trim().max(512).optional(),
    notes: z.string().trim().max(1000).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    if (data.provider === "google_drive" && !data.folderId && !data.folderUrl) {
      throw Object.assign(new Error("Add a Google Drive folder or folder link."), { status: 400 });
    }
    if (data.provider !== "google_drive" && !data.folderUrl) {
      throw Object.assign(new Error("Add the shared folder or storage link."), { status: 400 });
    }
    const parsedFolderId = data.folderId || (data.provider === "google_drive" && data.folderUrl
      ? data.folderUrl.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1]
      : undefined);
    if (data.provider === "google_drive" && !parsedFolderId) {
      throw Object.assign(new Error("The Google Drive folder link is not valid. Copy the folder URL from Drive."), { status: 400 });
    }
    return context.getBase44().asServiceRole.entities.VideoStorageSource.create({
      name: data.name,
      provider: data.provider,
      market_country: data.marketCountry.toUpperCase(),
      ...(data.folderUrl ? { folder_url: data.folderUrl } : {}),
      ...(parsedFolderId ? { folder_id: parsedFolderId } : {}),
      notes: data.notes || "",
      enabled: true,
      created_by: context.user.id,
    });
  });

export const deleteVideoStorageSource = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ sourceId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const source = await db.VideoStorageSource.get(data.sourceId).catch(() => null);
    if (!source) throw Object.assign(new Error("Storage source not found."), { status: 404 });
    await db.VideoStorageSource.delete(source.id);
    return { success: true };
  });

export const importLinkedStorageVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    sourceId: z.string().min(1).max(128),
    title: z.string().trim().min(2).max(180),
    videoUrl: z.string().trim().url().max(1500),
    previewUrl: z.string().trim().url().max(1500).optional(),
    downloadUrl: z.string().trim().url().max(1500).optional(),
    category: z.string().trim().max(80).optional(),
    language: z.string().trim().max(12).default("en"),
    rightsStatus: z.enum(rightsStatuses).default("pending"),
    rightsEvidenceUrl: z.string().url().max(1000).optional(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    if (data.rightsStatus === "authorised" && !data.rightsEvidenceUrl) {
      throw Object.assign(new Error("Written rights evidence is required before marking this video authorised."), { status: 400, code: "RIGHTS_EVIDENCE_REQUIRED" });
    }
    const db = context.getBase44().asServiceRole.entities;
    const source = await db.VideoStorageSource.get(data.sourceId).catch(() => null);
    if (!source || !source.enabled) throw Object.assign(new Error("Storage source is unavailable."), { status: 404 });
    const existing = await db.InternalVideoAsset.filter({ storage_url: data.videoUrl }, "-created_date", 1, 0);
    if (existing.length) {
      const current = existing[0];
      const updated = await db.InternalVideoAsset.update(current.id, {
        rights_status: data.rightsStatus,
        ...(data.rightsEvidenceUrl ? { rights_evidence_url: data.rightsEvidenceUrl } : {}),
      });
      return { asset: updated, alreadyImported: true, rightsUpdated: true };
    }
    const previewUrl = data.previewUrl || data.videoUrl;
    const asset = await db.InternalVideoAsset.create({
      title: data.title,
      description: "Imported from " + source.name,
      asset_type: "source",
      status: "ready",
      category: data.category || "Other",
      language: data.language,
      tags: [],
      target_countries: [source.market_country],
      rights_status: data.rightsStatus,
      ...(data.rightsEvidenceUrl ? { rights_evidence_url: data.rightsEvidenceUrl } : {}),
      storage_provider: source.provider,
      storage_source_id: source.id,
      storage_url: data.videoUrl,
      preview_url: previewUrl,
      download_url: data.downloadUrl || data.videoUrl,
      source_url: data.videoUrl,
      original_filename: data.title,
      mime_type: "video/mp4",
      review_status: "needs_review",
      public_video_status: "draft",
      created_by: context.user.id,
    });
    return { asset, alreadyImported: false };
  });

export const syncGoogleDriveStorageSource = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ sourceId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const db = context.getBase44().asServiceRole.entities;
    const source = await db.VideoStorageSource.get(data.sourceId).catch(() => null);
    if (!source || !source.enabled || source.provider !== "google_drive" || !source.folder_id) {
      throw Object.assign(new Error("This source is not a configured Google Drive folder."), { status: 400 });
    }
    let pageToken = undefined;
    let imported = 0;
    let skipped = 0;
    let total = 0;
    let pages = 0;
    do {
      const result = await fetchGoogleDriveVideoFiles(context.getBase44(), { parentId: source.folder_id, ...(pageToken ? { pageToken } : {}) });
      const files = result.files || [];
      total += files.length;
      for (const file of files) {
        const existing = await db.InternalVideoAsset.filter({ google_drive_file_id: file.id }, "-created_date", 1, 0);
        if (existing.length) { skipped += 1; continue; }
        const id = encodeURIComponent(file.id);
        await db.InternalVideoAsset.create({
          title: String(file.name || "Untitled video").slice(0, 180),
          description: "Imported from " + source.name,
          asset_type: "source",
          status: "ready",
          category: "Other",
          language: "und",
          tags: [],
          target_countries: [source.market_country],
          rights_status: "pending",
          storage_provider: "google_drive",
          storage_source_id: source.id,
          storage_url: "https://drive.google.com/uc?export=download&id=" + id,
          preview_url: "https://drive.google.com/file/d/" + id + "/preview",
          download_url: "https://drive.google.com/uc?export=download&id=" + id,
          google_drive_file_id: file.id,
          ...(Array.isArray(file.parents) && file.parents[0] ? { google_drive_parent_id: file.parents[0] } : {}),
          ...(file.webViewLink ? { google_drive_web_view_link: file.webViewLink } : {}),
          original_filename: String(file.name || "video").slice(0, 180),
          mime_type: file.mimeType || "video/mp4",
          file_size_bytes: Number(file.size || 0),
          review_status: "needs_review",
          public_video_status: "draft",
          created_by: context.user.id,
        });
        imported += 1;
      }
      pageToken = result.nextPageToken || undefined;
      pages += 1;
    } while (pageToken && pages < 20);
    return { imported, skipped, total, hasMore: !!pageToken };
  });
