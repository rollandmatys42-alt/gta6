import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { secrets } from "base44:runtime";
import { requireUser } from "@/lib/auth-middleware";

const encoder = new TextEncoder();
const MONTHLY_FREE_LIMIT = 5;
const DOWNLOAD_URL_TTL = 120;

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function hmac(keyBytes, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function utcParts(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}
async function signingKey(secret, dateStamp, region) {
  let key = await hmac(encoder.encode("AWS4" + secret), dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, "s3");
  return hmac(key, "aws4_request");
}
async function presignR2({ method, objectKey, contentType, expiresIn = DOWNLOAD_URL_TTL }) {
  const endpoint = secrets.get("VIDEO_STORAGE_ENDPOINT");
  const bucket = secrets.get("VIDEO_STORAGE_BUCKET");
  const accessKey = secrets.get("VIDEO_STORAGE_ACCESS_KEY_ID");
  const secretKey = secrets.get("VIDEO_STORAGE_SECRET_ACCESS_KEY");
  const region = secrets.get("VIDEO_STORAGE_REGION") || "auto";
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw Object.assign(new Error("Private video storage is not configured. Add the five VIDEO_STORAGE_* secrets before enabling downloads."), { status: 503, code: "VIDEO_STORAGE_NOT_CONFIGURED" });
  }
  if (!objectKey || objectKey.startsWith("/") || objectKey.split("/").some((part) => part === "..") || !/^[a-zA-Z0-9/_ .-]+$/.test(objectKey)) {
    throw Object.assign(new Error("Invalid private storage key."), { status: 400, code: "INVALID_STORAGE_KEY" });
  }
  const base = new URL(endpoint);
  if (base.protocol !== "https:") throw new Error("Video storage endpoint must use HTTPS.");
  const { amzDate, dateStamp } = utcParts(new Date());
  const scope = dateStamp + "/" + region + "/s3/aws4_request";
  const canonicalUri = (base.pathname.replace(/\/$/, "") + "/" + awsEncode(bucket) + "/" + objectKey.split("/").map(awsEncode).join("/")).replace(/\/+/g, "/");
  const headers = contentType ? "content-type:" + contentType.trim() + "\nhost:" + base.host + "\n" : "host:" + base.host + "\n";
  const signedHeaders = contentType ? "content-type;host" : "host";
  const params = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", accessKey + "/" + scope],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ].map(([k,v]) => awsEncode(k) + "=" + awsEncode(v)).sort().join("&");
  const canonicalRequest = [method, canonicalUri, params, headers, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");
  const signature = hex(await hmac(await signingKey(secretKey, dateStamp, region), stringToSign));
  return base.origin + canonicalUri + "?" + params + "&X-Amz-Signature=" + signature;
}

export const listPublishedVideos = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const base44 = context.getBase44();
  const rows = await base44.asServiceRole.entities.Video.filter(
    { status: "published", license_status: "verified" },
    "-published_at",
    60,
    0,
    ["id", "title", "description", "category", "tags", "duration_seconds", "thumbnail_url", "creator_name", "published_at"],
  );
  return rows;
});

export const requestVideoDownload = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const user = context.user;
    const video = await base44.asServiceRole.entities.Video.get(data.videoId).catch(() => null);
    if (!video || video.status !== "published" || video.license_status !== "verified") {
      throw Object.assign(new Error("This video is not available for download."), { status: 404, code: "VIDEO_NOT_AVAILABLE" });
    }

    const subscriptions = await base44.asServiceRole.entities.UserSubscription.filter(
      { user_id: user.id }, "-created_date", 1, 0,
    );
    const subscription = subscriptions[0];
    let tier = subscription?.tier_code || "free";
    if (tier !== "free" && subscription?.status !== "active") tier = "free";
    let limit = MONTHLY_FREE_LIMIT;
    let cleanDownloads = false;
    if (tier !== "free") {
      const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter(
        { tier_code: tier, status: "active" }, "-created_date", 1, 0,
      );
      const plan = plans[0];
      if (!plan) throw Object.assign(new Error("This subscription plan is not configured yet."), { status: 403, code: "PLAN_NOT_CONFIGURED" });
      limit = Number(plan.monthly_download_limit || 0);
      cleanDownloads = !!plan.clean_downloads;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw Object.assign(new Error("Your plan does not currently include video downloads."), { status: 403, code: "DOWNLOADS_NOT_INCLUDED" });
    }

    const watermarkApplied = tier === "free" || !cleanDownloads;
    const objectKey = watermarkApplied ? video.watermarked_storage_key : video.storage_key;
    if (!objectKey) {
      throw Object.assign(new Error(watermarkApplied
        ? "The watermarked video version has not been prepared yet."
        : "The clean video version is not available yet."), { status: 409, code: "VIDEO_RENDITION_NOT_READY" });
    }
    const downloadUrl = await presignR2({ method: "GET", objectKey, expiresIn: DOWNLOAD_URL_TTL });

    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7);
    let quotas = await base44.asServiceRole.entities.DownloadQuota.filter(
      { user_id: user.id, month_key: monthKey }, "-created_date", 2, 0,
    );
    let quota = quotas[0];
    if (!quota) {
      quota = await base44.asServiceRole.entities.DownloadQuota.create({
        user_id: user.id, month_key: monthKey, downloads_used: 0,
        downloads_limit: limit, tier_code: tier,
      });
    }
    // Atomic conditional increment protects the established monthly quota row.
    const reservation = await base44.asServiceRole.entities.DownloadQuota.updateMany(
      { id: quota.id, downloads_used: { $lt: limit } },
      { $inc: { downloads_used: 1 }, $set: { downloads_limit: limit, tier_code: tier, last_download_at: now.toISOString() } },
    );
    if (!reservation?.updated) {
      throw Object.assign(new Error("You have reached your monthly download allowance."), { status: 429, code: "MONTHLY_DOWNLOAD_LIMIT_REACHED", limit });
    }
    try {
      await base44.asServiceRole.entities.DownloadEvent.create({
        user_id: user.id, video_id: video.id, month_key: monthKey, tier_code: tier,
        watermark_applied: watermarkApplied, status: "signed",
        delivery_expires_at: new Date(now.getTime() + DOWNLOAD_URL_TTL * 1000).toISOString(),
      });
    } catch (error) {
      await base44.asServiceRole.entities.DownloadQuota.updateMany(
        { id: quota.id }, { $inc: { downloads_used: -1 } },
      );
      throw error;
    }
    return {
      downloadUrl,
      expiresInSeconds: DOWNLOAD_URL_TTL,
      watermarkApplied,
      downloadsLimit: limit,
      downloadsUsed: Number(quota.downloads_used || 0) + 1,
      downloadsRemaining: Math.max(0, limit - Number(quota.downloads_used || 0) - 1),
    };
  });

export const createVideoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    fileName: z.string().min(1).max(180).regex(/^[a-zA-Z0-9._ -]+$/),
    contentType: z.enum(["video/mp4", "video/quicktime"]),
    assetVariant: z.enum(["original", "watermarked"]),
  }))
  .handler(async ({ data, context }) => {
    if (context.user.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
    const extension = data.contentType === "video/quicktime" ? "mov" : "mp4";
    const objectKey = "videos/" + data.assetVariant + "/" + crypto.randomUUID() + "." + extension;
    const uploadUrl = await presignR2({ method: "PUT", objectKey, contentType: data.contentType, expiresIn: 300 });
    return { uploadUrl, objectKey, contentType: data.contentType, expiresInSeconds: 300 };
  });

export const createVideoRecord = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    title: z.string().min(2).max(140),
    description: z.string().max(3000).optional(),
    category: z.enum(["Cinematics", "Gameplay", "Edit packs", "Tutorials", "Other"]),
    tags: z.array(z.string().max(40)).max(20).optional(),
    durationSeconds: z.number().int().min(0).max(86400).optional(),
    thumbnailUrl: z.string().url().max(1000).optional(),
    creatorName: z.string().max(80).optional(),
    sourceReference: z.string().url().max(1000).optional(),
    licenseVerified: z.boolean(),
    originalStorageKey: z.string().min(1).max(300),
    watermarkedStorageKey: z.string().min(1).max(300),
  }))
  .handler(async ({ data, context }) => {
    if (context.user.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
    if (!data.originalStorageKey.startsWith("videos/original/") || !data.watermarkedStorageKey.startsWith("videos/watermarked/")) {
      throw Object.assign(new Error("Video assets must use the private original and watermarked storage paths."), { status: 400, code: "INVALID_ASSET_PATH" });
    }
    const base44 = context.getBase44();
    return base44.asServiceRole.entities.Video.create({
      title: data.title, description: data.description || "", category: data.category,
      tags: data.tags || [], duration_seconds: data.durationSeconds || 0,
      ...(data.thumbnailUrl ? { thumbnail_url: data.thumbnailUrl } : {}),
      creator_name: data.creatorName || "",
      ...(data.sourceReference ? { source_reference: data.sourceReference } : {}),
      license_status: data.licenseVerified ? "verified" : "pending",
      storage_key: data.originalStorageKey, watermarked_storage_key: data.watermarkedStorageKey,
      uploaded_by: context.user.id, status: "draft",
    });
  });

export const publishVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    if (context.user.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
    const base44 = context.getBase44();
    const video = await base44.asServiceRole.entities.Video.get(data.videoId);
    if (video.license_status !== "verified" || !video.storage_key || !video.watermarked_storage_key) {
      throw Object.assign(new Error("Verify the content licence and upload both private renditions before publishing."), { status: 409, code: "PUBLISH_REQUIREMENTS_NOT_MET" });
    }
    return base44.asServiceRole.entities.Video.update(video.id, {
      status: "published", published_at: new Date().toISOString(),
    });
  });

export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const base44 = context.getBase44();
    const user = context.user;
    const subscriptions = await base44.asServiceRole.entities.UserSubscription.filter(
      { user_id: user.id }, "-created_date", 1, 0,
    );
    const subscription = subscriptions[0];
    const tier = subscription?.status === "active" ? (subscription.tier_code || "free") : "free";
    let limit = MONTHLY_FREE_LIMIT;
    let planName = "Free";
    if (tier !== "free") {
      const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter(
        { tier_code: tier, status: "active" }, "-created_date", 1, 0,
      );
      if (plans[0]) {
        limit = Number(plans[0].monthly_download_limit || 0);
        planName = plans[0].display_name || tier;
      }
    }
    const monthKey = new Date().toISOString().slice(0, 7);
    const quotas = await base44.asServiceRole.entities.DownloadQuota.filter(
      { user_id: user.id, month_key: monthKey }, "-created_date", 1, 0,
    );
    const used = Number(quotas[0]?.downloads_used || 0);
    const history = await base44.asServiceRole.entities.DownloadEvent.filter(
      { user_id: user.id }, "-created_date", 15, 0,
      ["id", "video_id", "month_key", "tier_code", "watermark_applied", "status", "created_date"],
    );
    return {
      name: user.full_name || user.email || "Creator",
      email: user.email,
      tier,
      planName,
      subscriptionStatus: subscription?.status || "inactive",
      currency: subscription?.currency || "USD",
      downloadsUsed: used,
      downloadsLimit: limit,
      downloadsRemaining: Math.max(0, limit - used),
      history,
    };
  });
