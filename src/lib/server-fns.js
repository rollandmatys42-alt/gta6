import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { secrets } from "base44:runtime";
import { requireUser } from "@/lib/auth-middleware";
import { priceForMonth } from "@/lib/loyalty";

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
    throw Object.assign(new Error("Private video storage is not configured. Add VIDEO_STORAGE_ENDPOINT, VIDEO_STORAGE_BUCKET, VIDEO_STORAGE_ACCESS_KEY_ID and VIDEO_STORAGE_SECRET_ACCESS_KEY. VIDEO_STORAGE_REGION is optional and defaults to auto."), { status: 503, code: "VIDEO_STORAGE_NOT_CONFIGURED" });
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

export const testVideoStorage = createServerFn({ method: "POST" }).middleware([requireUser]).handler(async ({ context }) => {
  requireAdmin(context);
  const objectKey = "system/health-check-" + Date.now() + ".txt";
  const marker = "VICEHUB-R2-PRIVATE-HEALTH-CHECK";
  const started = Date.now();
  let uploaded = false;
  try {
    const putUrl = await presignR2({ method: "PUT", objectKey, contentType: "text/plain", expiresIn: 60 });
    const putResponse = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: marker });
    if (!putResponse.ok) throw new Error("R2 write test failed with HTTP " + putResponse.status + ".");
    uploaded = true;
    const getUrl = await presignR2({ method: "GET", objectKey, expiresIn: 60 });
    const getResponse = await fetch(getUrl);
    if (!getResponse.ok) throw new Error("R2 read test failed with HTTP " + getResponse.status + ".");
    const actual = await getResponse.text();
    if (actual !== marker) throw new Error("R2 read-back verification did not match the test marker.");
    const deleteUrl = await presignR2({ method: "DELETE", objectKey, expiresIn: 60 });
    const deleteResponse = await fetch(deleteUrl, { method: "DELETE" });
    if (!deleteResponse.ok) throw new Error("R2 cleanup failed with HTTP " + deleteResponse.status + ".");
    uploaded = false;
    return { ok: true, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, testObjectRemoved: true };
  } finally {
    if (uploaded) {
      try {
        const deleteUrl = await presignR2({ method: "DELETE", objectKey, expiresIn: 60 });
        await fetch(deleteUrl, { method: "DELETE" });
      } catch {}
    }
  }
});

export const listPublishedVideos = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const base44 = context.getBase44();
  const rows = await base44.asServiceRole.entities.Video.filter(
    { status: "published", license_status: "verified" },
    "-published_at",
    60,
    0,
    ["id", "title", "description", "category", "language", "is_featured", "tags", "duration_seconds", "thumbnail_url", "creator_name", "published_at"],
  );
  return rows;
});

export const getVideoPreviewUrl = createServerFn({ method: "GET" })
  .validator(z.object({ videoId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const video = await base44.asServiceRole.entities.Video.get(data.videoId).catch(() => null);
    if (!video || video.status !== "published" || video.license_status !== "verified") {
      throw Object.assign(new Error("This video is not available for preview."), { status: 404, code: "VIDEO_NOT_AVAILABLE" });
    }
    if (!video.watermarked_storage_key || !video.watermarked_storage_key.startsWith("videos/watermarked/")) {
      throw Object.assign(new Error("The protected preview is not ready yet."), { status: 409, code: "PREVIEW_NOT_READY" });
    }
    const previewUrl = await presignR2({ method: "GET", objectKey: video.watermarked_storage_key, expiresIn: 180 });
    return { previewUrl, expiresInSeconds: 180, watermarkApplied: true };
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
    if (tier !== "free" && subscription?.status !== "active" && !(subscription?.status === "past_due" && subscription?.grace_period_ends_at && new Date(subscription.grace_period_ends_at) > new Date())) tier = "free";
    let limit = MONTHLY_FREE_LIMIT;
    let cleanDownloads = false;
    if (tier !== "free") {
      const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter(
        { tier_code: tier, currency: subscription?.currency || "USD", status: "active" }, "-created_date", 1, 0,
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
    category: z.enum(["Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions", "Shorts", "Edit packs", "Tutorials", "Other"]),
    language: z.enum(["en", "fr", "es", "pt", "it", "de"]).default("en"),
    isFeatured: z.boolean().default(false),
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
    if (data.licenseVerified && !data.sourceReference) {
      throw Object.assign(new Error("A rights or licence evidence reference is required before a video can be marked verified."), { status: 400, code: "RIGHTS_EVIDENCE_REQUIRED" });
    }
    const base44 = context.getBase44();
    return base44.asServiceRole.entities.Video.create({
      title: data.title, description: data.description || "", category: data.category,
      language: data.language || "en", is_featured: !!data.isFeatured,
      tags: data.tags || [], duration_seconds: data.durationSeconds || 0,
      ...(data.thumbnailUrl ? { thumbnail_url: data.thumbnailUrl } : {}),
      creator_name: data.creatorName || "",
      ...(data.sourceReference ? { source_reference: data.sourceReference } : {}),
      license_status: data.licenseVerified ? "verified" : "pending",
      storage_key: data.originalStorageKey, watermarked_storage_key: data.watermarkedStorageKey,
      uploaded_by: context.user.id, status: "draft",
    });
  });

function parseAdminCsv(text) {
 const rows=[];let row=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}else if(ch==='"'&&field==="")quoted=true;else if(ch===","){row.push(field);field="";}else if(ch===String.fromCharCode(10)||ch===String.fromCharCode(13)){if(ch===String.fromCharCode(13)&&text[i+1]===String.fromCharCode(10))i++;row.push(field);field="";if(row.some(x=>String(x).trim()))rows.push(row);row=[];}else field+=ch;}
 row.push(field);if(row.some(x=>String(x).trim()))rows.push(row);return rows;
}
export const importAdminVideoMetadataCsv = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({csvText:z.string().min(10).max(5000000)})).handler(async({data,context})=>{
 requireAdmin(context);const rows=parseAdminCsv(data.csvText);if(rows.length<2)throw Object.assign(new Error("The CSV must contain a header row and at least one video row."),{status:400});const headers=rows[0].map(x=>String(x).trim().toLowerCase());const titleIndex=headers.indexOf("title"),categoryIndex=headers.indexOf("category");if(titleIndex<0||categoryIndex<0)throw Object.assign(new Error("CSV headers must include title and category."),{status:400});if(rows.length-1>1000)throw Object.assign(new Error("Import is limited to 1,000 metadata rows per batch."),{status:400});const get=(r,key)=>{const i=headers.indexOf(key);return i<0?"":String(r[i]||"").trim();};const categories=["Cinematics","Gameplay","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"];const languages=["en","fr","es","pt","it","de"];const records=[],rejected=[];for(let i=1;i<rows.length;i++){const r=rows[i];const title=get(r,"title");const rawCategory=get(r,"category");const category=categories.find(x=>x.toLowerCase()===rawCategory.toLowerCase());const language=(get(r,"language")||"en").toLowerCase();const source=get(r,"source_reference");if(!title||title.length<2){rejected.push({line:i+1,reason:"Missing or invalid title"});continue;}if(!category){rejected.push({line:i+1,reason:"Unknown category: "+rawCategory});continue;}if(!languages.includes(language)){rejected.push({line:i+1,reason:"Unsupported language: "+language});continue;}if(source){try{const parsed=new URL(source);if(!["http:","https:"].includes(parsed.protocol))throw new Error("Unsupported protocol");}catch{rejected.push({line:i+1,reason:"source_reference must be an HTTP or HTTPS URL"});continue;}}const duration=Number(get(r,"duration_seconds")||0);if(duration<0||duration>86400||!Number.isInteger(duration)){rejected.push({line:i+1,reason:"Invalid duration_seconds"});continue;}records.push({title:title.slice(0,140),description:get(r,"description").slice(0,3000),category,language,creator_name:get(r,"creator_name").slice(0,80),...(source?{source_reference:source}:{}),...(duration?{duration_seconds:duration}:{}),is_featured:false,status:"draft",license_status:"pending"});}
 const db=context.getBase44().asServiceRole.entities.Video;let imported=0;for(let i=0;i<records.length;i+=100){const created=await db.bulkCreate(records.slice(i,i+100));imported+=created.length;}return {imported,rejected:rejected.length,errors:rejected.slice(0,30),message:"Imported as metadata-only drafts. No media file or licence has been verified; upload and rights review are still required before publication."};
});
export const getAdminVideoLibrary = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.Video.list("-created_date",2000,0);});
export const updateAdminVideo = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({videoId:z.string().min(1),title:z.string().min(2).max(140).optional(),description:z.string().max(3000).optional(),category:z.enum(["Cinematics","Gameplay","Characters","Vehicles","Locations","Missions","Shorts","Edit packs","Tutorials","Other"]).optional(),language:z.enum(["en","fr","es","pt","it","de"]).optional(),isFeatured:z.boolean().optional(),licenseStatus:z.enum(["pending","verified","restricted"]).optional(),sourceReference:z.string().url().max(1000).optional()})).handler(async({data,context})=>{requireAdmin(context);const db=context.getBase44().asServiceRole.entities.Video;const current=await db.get(data.videoId);if(data.licenseStatus==="verified"&&!data.sourceReference&&!current.source_reference)throw Object.assign(new Error("A rights/source reference is required before verifying the licence."),{status:400});const patch={};for(const [key,value] of Object.entries({title:data.title,description:data.description,category:data.category,language:data.language,is_featured:data.isFeatured,license_status:data.licenseStatus,source_reference:data.sourceReference}))if(value!==undefined)patch[key]=value;return db.update(data.videoId,patch);});
export const archiveAdminVideo = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({videoId:z.string().min(1),archived:z.boolean()})).handler(async({data,context})=>{requireAdmin(context);const db=context.getBase44().asServiceRole.entities.Video;const video=await db.get(data.videoId);if(!data.archived&&video.license_status!=="verified")return db.update(data.videoId,{status:"draft"});return db.update(data.videoId,{status:data.archived?"archived":"draft"});});
export const publishVideo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ videoId: z.string().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    if (context.user.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
    const base44 = context.getBase44();
    const video = await base44.asServiceRole.entities.Video.get(data.videoId);
    if (video.license_status !== "verified" || !video.source_reference || !video.storage_key || !video.watermarked_storage_key) {
      throw Object.assign(new Error("Record a rights/licence evidence reference, verify the content licence and upload both private renditions before publishing."), { status: 409, code: "PUBLISH_REQUIREMENTS_NOT_MET" });
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
    const tier = subscription?.status === "active" || (subscription?.status === "past_due" && subscription?.grace_period_ends_at && new Date(subscription.grace_period_ends_at) > new Date()) ? (subscription.tier_code || "free") : "free";
    let limit = MONTHLY_FREE_LIMIT;
    let planName = "Free";
    if (tier !== "free") {
      const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter(
        { tier_code: tier, currency: subscription?.currency || "USD", status: "active" }, "-created_date", 1, 0,
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
    const historyWithTitles = await Promise.all(history.map(async event => {
      const video = await base44.asServiceRole.entities.Video.get(event.video_id).catch(() => null);
      return { ...event, video_title: video?.title || "Video download" };
    }));
    return {
      name: user.full_name || user.email || "Creator",
      email: user.email,
      tier,
      planName,
      subscriptionStatus: subscription?.status || "inactive",
      currency: subscription?.currency || "USD",
      hasBillingCustomer: !!subscription?.stripe_customer_id,
      downloadsUsed: used,
      downloadsLimit: limit,
      downloadsRemaining: Math.max(0, limit - used),
      history: historyWithTitles,
    };
  });


function requireAdmin(context) {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403, code: "ADMIN_REQUIRED" });
}
function publicArticle(article) {
  const { storage_key, watermarked_storage_key, ...safe } = article;
  return safe;
}

export const getNewsFeed = createServerFn({ method: "GET" })
  .validator(z.object({ locale: z.enum(["en","fr","es","de","it","pt"]).optional(), limit: z.number().int().min(1).max(50).optional() }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const query = { status: "published", ...(data.locale ? { locale: data.locale } : { locale: "en" }) };
    const rows = await base44.asServiceRole.entities.NewsArticle.filter(query, "-published_at", data.limit || 30, 0);
    return rows.map(publicArticle);
  });

export const getAdminNews = createServerFn({ method: "GET" })
  .middleware([requireUser]).handler(async ({ context }) => {
    requireAdmin(context);
    return context.getBase44().asServiceRole.entities.NewsArticle.filter({}, "-created_date", 100, 0);
  });

export const saveNewsArticle = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    id: z.string().optional(), title: z.string().min(3).max(180), slug: z.string().min(3).max(200).regex(/^[a-z0-9-]+$/),
    summary: z.string().max(500), body: z.string().min(1).max(20000), sourceName: z.string().min(2).max(100),
    sourceUrl: z.string().url().max(1000), sourceType: z.enum(["official","media","community","social"]),
    confidence: z.enum(["official","confirmed","reported","rumour","theory","opinion"]),
    locale: z.enum(["en","fr","es","de","it","pt"]), tags: z.array(z.string().max(40)).max(15).optional(),
    status: z.enum(["draft","published","archived"])
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const base44 = context.getBase44();
    const payload = { title:data.title, slug:data.slug, summary:data.summary, body:data.body, source_name:data.sourceName,
      source_url:data.sourceUrl, source_type:data.sourceType, confidence:data.confidence, locale:data.locale,
      tags:data.tags||[], status:data.status, created_by:context.user.id,
      ...(data.status==="published" ? {published_at:new Date().toISOString()} : {}) };
    if (data.id) return base44.asServiceRole.entities.NewsArticle.update(data.id,payload);
    return base44.asServiceRole.entities.NewsArticle.create(payload);
  });

export const getNewsSources = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
  requireAdmin(context); return context.getBase44().asServiceRole.entities.NewsSource.list("-created_date",100,0);
});
export const saveNewsSource = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),name:z.string().min(2).max(100),feedUrl:z.string().url().max(1000),sourceType:z.enum(["official","media","community","social"]),enabled:z.boolean()}))
 .handler(async({data,context})=>{
  requireAdmin(context); const db=context.getBase44().asServiceRole.entities.NewsSource;
  const payload={name:data.name,feed_url:data.feedUrl,source_type:data.sourceType,enabled:data.enabled,created_by:context.user.id};
  return data.id?db.update(data.id,payload):db.create(payload);
 });

export const syncNewsSources = createServerFn({method:"POST"}).middleware([requireUser]).handler(async({context})=>{
  requireAdmin(context);
  const db=context.getBase44().asServiceRole;
  const sources=await db.entities.NewsSource.filter({enabled:true},"-created_date",30,0);
  const report=[];
  for(const source of sources){
    try{
      const url=new URL(source.feed_url);
      if(url.protocol!=="https:" || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error("Only public HTTPS feed URLs are allowed.");
      if(url.hostname==="api.x.com" || url.hostname==="api.twitter.com"){
        const token=secrets.get("X_BEARER_TOKEN");
        if(!token)throw new Error("X API source configured but X_BEARER_TOKEN is not set in Base44 secrets.");
        const response=await fetch(url.toString(),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
        if(!response.ok)throw new Error("X API returned HTTP "+response.status);
        const payload=await response.json();
        const users=new Map((payload.includes?.users||[]).map(u=>[u.id,u]));
        let created=0;
        for(const tweet of (payload.data||[]).slice(0,20)){
          const author=users.get(tweet.author_id),username=author?.username||"X user";
          const articleUrl="https://x.com/"+username+"/status/"+tweet.id;
          const exists=await db.entities.NewsArticle.filter({source_url:articleUrl},"-created_date",1,0);
          if(exists.length)continue;
          const title=(tweet.text||"GTA VI social update").replace(/\s+/g," ").slice(0,170);
          await db.entities.NewsArticle.create({title,slug:title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,150)+"-"+crypto.randomUUID().slice(0,6),summary:(tweet.text||"").slice(0,500),body:tweet.text||"",source_name:"@"+username,source_url:articleUrl,source_type:"social",confidence:"reported",locale:"en",status:"draft",tags:["X import"],created_by:context.user.id});
          created++;
        }
        await db.entities.NewsSource.update(source.id,{last_checked_at:new Date().toISOString(),last_status:"X API OK — "+created+" new drafts"});
        report.push({source:source.name,created,status:"ok"});continue;
      }
      const response=await fetch(url.toString(),{headers:{"Accept":"application/rss+xml, application/atom+xml, application/xml, text/xml"}});
      if(!response.ok) throw new Error("Feed returned HTTP "+response.status);
      const xml=(await response.text()).slice(0,1500000);
      const items=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0,20);
      let created=0;
      for(const match of items){
        const block=match[2];
        const read=(tag)=>{const m=block.match(new RegExp("<"+tag+"\\b[^>]*>([\\s\\S]*?)<\/"+tag+">","i"));return m?m[1].replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim():"";};
        const title=read("title").slice(0,180);
        const linkMatch=block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
        const articleUrl=read("link") || linkMatch?.[1] || "";
        const summary=(read("description")||read("summary")||read("content")).slice(0,500);
        const gta6Match=/\bgta\s*(?:vi|6)\b|\bgta6\b|grand theft auto\s*vi/i.test(title+" "+summary);
        if(!title || !articleUrl.startsWith("https://") || !gta6Match) continue;
        const exists=await db.entities.NewsArticle.filter({source_url:articleUrl}, "-created_date",1,0);
        if(exists.length) continue;
        const slug=title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,170)+"-"+crypto.randomUUID().slice(0,6);
        await db.entities.NewsArticle.create({title,slug,summary:summary||"Imported from "+source.name,body:summary||title,source_name:source.name,source_url:articleUrl,source_type:source.source_type,confidence:source.source_type==="official"?"official":"reported",locale:"en",status:"draft",tags:["RSS import"],created_by:context.user.id});
        created++;
      }
      await db.entities.NewsSource.update(source.id,{last_checked_at:new Date().toISOString(),last_status:"OK — "+created+" new drafts"});
      report.push({source:source.name,created,status:"ok"});
    }catch(error){
      await db.entities.NewsSource.update(source.id,{last_checked_at:new Date().toISOString(),last_status:String(error.message||error).slice(0,190)});
      report.push({source:source.name,created:0,status:"error",error:String(error.message||error)});
    }
  }
  return report;
});

export const getCommunity = createServerFn({method:"GET"})
 .validator(z.object({categoryId:z.string().optional()}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const categories=await db.ForumCategory.filter({status:"active"},"sort_order",50,0);
  const threads=await db.ForumThread.filter({status:"published",...(data.categoryId?{category_id:data.categoryId}:{})},"-last_activity_at",60,0);
  return {categories,threads};
 });
export const createForumThread = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({title:z.string().min(4).max(160),body:z.string().min(4).max(10000),categoryId:z.string().optional(),categoryName:z.string().max(80).optional()}))
 .handler(async({data,context})=>{
  const user=context.user,db=context.getBase44().asServiceRole.entities;
  return db.ForumThread.create({title:data.title,body:data.body,category_id:data.categoryId||"",category_name:data.categoryName||"General",author_id:user.id,author_name:user.full_name||user.email||"Creator",status:"published",pinned:false,reply_count:0,last_activity_at:new Date().toISOString()});
 });
export const getForumThread = createServerFn({method:"GET"}).validator(z.object({threadId:z.string().min(1)})).handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const thread=await db.ForumThread.get(data.threadId).catch(()=>null);
  if(!thread || thread.status!=="published") throw Object.assign(new Error("Discussion not found."),{status:404});
  const [posts,reactions]=await Promise.all([db.ForumPost.filter({thread_id:data.threadId,status:"published"},"created_date",100,0),db.ForumReaction.filter({target_type:"thread",target_id:data.threadId},"-created_date",500,0)]);
  return {thread,posts,reactions};
 });
export const createForumPost = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({threadId:z.string().min(1),body:z.string().min(1).max(5000)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const thread=await db.ForumThread.get(data.threadId).catch(()=>null);
  if(!thread || thread.status!=="published") throw Object.assign(new Error("This discussion is unavailable."),{status:404});
  if(thread.status==="locked") throw Object.assign(new Error("This discussion is locked."),{status:403});
  const user=context.user;
  const post=await db.ForumPost.create({thread_id:thread.id,body:data.body,author_id:user.id,author_name:user.full_name||user.email||"Creator",status:"published"});
  await db.ForumThread.update(thread.id,{reply_count:Number(thread.reply_count||0)+1,last_activity_at:new Date().toISOString()});
  if(thread.author_id!==user.id)await db.UserNotification.create({user_id:thread.author_id,type:"reply",title:"New reply to your discussion",body:"Someone replied to: "+thread.title.slice(0,120),target_url:"/community"});
  return post;
 });

export const getMarketplaceListings = createServerFn({method:"GET"}).validator(z.object({category:z.string().optional()})).handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  return db.MarketplaceListing.filter({status:"published",...(data.category?{category:data.category}:{})},"-created_date",60,0);
});
export const getMyListings = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
  return context.getBase44().asServiceRole.entities.MarketplaceListing.filter({seller_id:context.user.id},"-created_date",100,0);
});
export const saveMarketplaceListing = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),title:z.string().min(3).max(160),description:z.string().max(5000),category:z.enum(["Video pack","Editing preset","Template","Creator bundle","Other"]),priceCents:z.number().int().min(0).max(100000000),currency:z.enum(["USD","EUR","GBP"]),licenseTerms:z.string().max(2000),previewUrl:z.string().url().optional()}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const subs=await db.UserSubscription.filter({user_id:context.user.id},"-created_date",1,0);
  const premiumActive=subs[0]?.tier_code==="premium" && subs[0]?.status==="active" && !subs[0]?.voluntary_cancelled;
  const payload={seller_id:context.user.id,seller_name:context.user.full_name||context.user.email||"Creator",title:data.title,description:data.description,category:data.category,price_cents:data.priceCents,currency:data.currency,license_terms:data.licenseTerms,status:premiumActive?"pending_review":"draft",created_by:context.user.id,...(data.previewUrl?{preview_url:data.previewUrl}:{})};
  if(data.id){const existing=await db.MarketplaceListing.get(data.id).catch(()=>null);if(!existing||existing.seller_id!==context.user.id)throw Object.assign(new Error("You can only edit your own listing."),{status:403});return db.MarketplaceListing.update(existing.id,payload);}
  return db.MarketplaceListing.create(payload);
 });
export const createMarketplaceInquiry = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({listingId:z.string().min(1),message:z.string().min(5).max(2000)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities,listing=await db.MarketplaceListing.get(data.listingId).catch(()=>null);
  if(!listing||listing.status!=="published") throw Object.assign(new Error("Listing not found."),{status:404});
  if(listing.seller_id===context.user.id) throw Object.assign(new Error("You cannot contact yourself."),{status:400});
  const [buyerBlock,sellerBlock]=await Promise.all([db.UserBlock.filter({blocker_id:context.user.id,blocked_id:listing.seller_id},"-created_date",1,0),db.UserBlock.filter({blocker_id:listing.seller_id,blocked_id:context.user.id},"-created_date",1,0)]);
  if(buyerBlock.length||sellerBlock.length)throw Object.assign(new Error("This enquiry cannot be sent because one user has blocked the other."),{status:403});
  const inquiry=await db.MarketplaceInquiry.create({listing_id:listing.id,buyer_id:context.user.id,seller_id:listing.seller_id,message:data.message,status:"open"});
  await db.UserNotification.create({user_id:listing.seller_id,type:"marketplace",title:"New marketplace enquiry",body:"A buyer has contacted you about "+listing.title.slice(0,100),target_url:"/marketplace"});
  return inquiry;
 });

export const getShopProducts = createServerFn({method:"GET"}).handler(async({context})=>{
 const rows=await context.getBase44().asServiceRole.entities.ShopProduct.filter({status:"published"},"-created_date",100,0);
 return rows.filter(p=>["original","licensed","official_external"].includes(p.rights_status||"")).sort((a,b)=>Number(!!b.is_featured)-Number(!!a.is_featured));
});
export const getAdminShopProducts = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.ShopProduct.list("-created_date",200,0);
});
export const saveShopProduct = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({
  id:z.string().optional(),title:z.string().min(2).max(160),description:z.string().max(5000),
  productType:z.enum(["physical","digital","external"]),priceCents:z.number().int().min(0),
  currency:z.enum(["USD","EUR","GBP"]),stockQuantity:z.number().int().min(0).optional(),
  imageUrl:z.string().url().optional(),status:z.enum(["draft","published","archived"]),sku:z.string().max(80).optional(),
  category:z.enum(["Apparel","Accessories","Collectibles","Digital","Creator Gear","Other"]),
  vendorType:z.enum(["vicehub","licensed_partner","official_external"]),
  rightsStatus:z.enum(["unverified","original","licensed","official_external"]),rightsEvidenceUrl:z.string().url().optional(),rightsNote:z.string().max(1000).optional(),
  externalUrl:z.string().url().optional(),shippingRequired:z.boolean(),shippingPriceCents:z.number().int().min(0),
  sizeOptions:z.array(z.string().max(40)).max(30),colorOptions:z.array(z.string().max(40)).max(30),isFeatured:z.boolean()
 }))
 .handler(async({data,context})=>{
  requireAdmin(context);
  if(data.status==="published"&&data.rightsStatus==="unverified")throw Object.assign(new Error("Rights must be verified before a product can be published."),{status:400,code:"SHOP_RIGHTS_NOT_VERIFIED"});
  if(data.status==="published"&&data.rightsStatus==="licensed"&&!data.rightsEvidenceUrl)throw Object.assign(new Error("A licence evidence URL is required before publishing a licensed partner product."),{status:400,code:"SHOP_LICENCE_EVIDENCE_REQUIRED"});
  if(data.rightsStatus==="original"&&data.vendorType!=="vicehub"||data.rightsStatus==="licensed"&&data.vendorType!=="licensed_partner")throw Object.assign(new Error("The product origin and rights classification do not match."),{status:400,code:"SHOP_RIGHTS_CLASSIFICATION_MISMATCH"});
  if(data.externalUrl&&!data.externalUrl.startsWith("https://"))throw Object.assign(new Error("External retailer links must use HTTPS."),{status:400});
  if(data.productType==="external"&&(!data.externalUrl||data.rightsStatus!=="official_external"||data.vendorType!=="official_external"))throw Object.assign(new Error("External official listings need an external URL and the official external classification."),{status:400,code:"SHOP_EXTERNAL_LINK_REQUIRED"});
  if(data.productType!=="external"&&data.vendorType==="official_external")throw Object.assign(new Error("Official external products must use the external link product type."),{status:400});
  if(data.rightsStatus==="official_external"&&(data.productType!=="external"||data.vendorType!=="official_external"))throw Object.assign(new Error("Official external listings must be marked as external retailer links."),{status:400,code:"SHOP_EXTERNAL_CLASSIFICATION_MISMATCH"});
  const db=context.getBase44().asServiceRole.entities.ShopProduct;
  const p={
   title:data.title,description:data.description,product_type:data.productType,price_cents:data.priceCents,currency:data.currency,
   stock_quantity:data.stockQuantity||0,status:data.status,sku:data.sku||"",category:data.category,vendor_type:data.vendorType,
   rights_status:data.rightsStatus,rights_note:data.rightsNote||"",shipping_required:data.productType==="physical"&&data.shippingRequired,
   shipping_price_cents:data.productType==="physical"&&data.shippingRequired?data.shippingPriceCents:0,
   size_options:data.sizeOptions,color_options:data.colorOptions,is_featured:data.isFeatured,
   ...(data.imageUrl?{image_url:data.imageUrl}:{}),...(data.externalUrl?{external_url:data.externalUrl}:{}),...(data.rightsEvidenceUrl?{rights_evidence_url:data.rightsEvidenceUrl}:{})
  };
  return data.id?db.update(data.id,p):db.create(p);
 });
export const getShopPaymentReadiness = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return {stripeConfigured:!!secrets.get("STRIPE_SECRET_KEY"),webhookConfigured:!!secrets.get("STRIPE_WEBHOOK_SECRET"),taxEnabled:secrets.get("STRIPE_TAX_ENABLED")==="true"};
});
export const getMyShopOrders = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 return context.getBase44().asServiceRole.entities.ShopOrder.filter({user_id:context.user.id},"-created_date",30,0);
});
export const getAdminShopOrders = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.ShopOrder.list("-created_date",200,0);
});
export const refundShopOrder = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({orderId:z.string().min(1)}))
 .handler(async({data,context})=>{
  requireAdmin(context);
  const db=context.getBase44().asServiceRole.entities.ShopOrder;
  const order=await db.get(data.orderId).catch(()=>null);
  if(!order)throw Object.assign(new Error("Order not found."),{status:404});
  if(!order.stripe_payment_intent_id)throw Object.assign(new Error("This order has no verified Stripe payment to refund."),{status:409});
  if(!["paid","paid_stock_issue","processing","shipped","delivered"].includes(order.status))throw Object.assign(new Error("Only a paid order can be refunded."),{status:409});
  const claim=await db.updateMany({id:order.id,status:order.status},{$set:{status:"refund_pending"}});
  if(!claim?.updated)throw Object.assign(new Error("Another order operation is already processing this order."),{status:409});
  try{
   const form=new URLSearchParams();form.set("payment_intent",order.stripe_payment_intent_id);form.set("reason","requested_by_customer");
   const refund=await stripeApi("refunds","POST",form);
   if(!refund.id||!["succeeded","pending"].includes(refund.status))throw new Error("Stripe did not confirm the refund.");
   return await db.update(order.id,{status:refund.status==="succeeded"?"refunded":"refund_pending",stripe_refund_id:refund.id,...(refund.status==="succeeded"?{refunded_at:new Date().toISOString()}:{}),admin_note:(order.admin_note?order.admin_note+" | ":"")+"Refund "+refund.id+" ("+refund.status+")"});
  }catch(error){
   await db.update(order.id,{status:order.status}).catch(()=>null);
   throw error;
  }
 });

export const updateShopOrder = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({orderId:z.string().min(1),status:z.enum(["pending_payment","payment_verifying","payment_failed","paid","paid_stock_issue","processing","shipped","delivered","cancelled","refund_pending","refunded"]),trackingNumber:z.string().max(120).optional(),trackingUrl:z.string().url().optional(),adminNote:z.string().max(1000).optional()}))
 .handler(async({data,context})=>{
  requireAdmin(context);
  const db=context.getBase44().asServiceRole.entities.ShopOrder;
  const order=await db.get(data.orderId).catch(()=>null);
  if(!order)throw Object.assign(new Error("Order not found."),{status:404});
  if(["paid","paid_stock_issue","payment_verifying","refund_pending","refunded","payment_failed"].includes(data.status)&&data.status!==order.status)throw Object.assign(new Error("Payment and refund states are controlled by Stripe confirmation and the secure refund action."),{status:409,code:"PAYMENT_STATE_LOCKED"});
  if(["processing","shipped","delivered"].includes(data.status)&&!["paid","paid_stock_issue","processing","shipped","delivered"].includes(order.status))throw Object.assign(new Error("This order cannot move to fulfilment until Stripe confirms payment."),{status:409,code:"ORDER_NOT_PAID"});
  const fulfilmentRank={paid:1,paid_stock_issue:1,processing:2,shipped:3,delivered:4};
  if(fulfilmentRank[data.status]&&fulfilmentRank[order.status]&&fulfilmentRank[data.status]<fulfilmentRank[order.status])throw Object.assign(new Error("Order fulfilment cannot move backwards."),{status:409,code:"ORDER_STATUS_REGRESSION"});
  if(data.status==="pending_payment"&&order.status!=="pending_payment")throw Object.assign(new Error("An order cannot be reset to pending payment."),{status:409,code:"ORDER_STATUS_REGRESSION"});
  if(data.status==="cancelled"&&["paid","paid_stock_issue","processing","shipped","delivered","refund_pending","refunded"].includes(order.status))throw Object.assign(new Error("A paid order must be refunded in Stripe before it can be cancelled."),{status:409,code:"REFUND_REQUIRED"});
  if(["cancelled","refunded","payment_failed"].includes(order.status)&&data.status!==order.status)throw Object.assign(new Error("This order is closed and cannot be reopened."),{status:409,code:"ORDER_CLOSED"});
  const patch={status:data.status,tracking_number:data.trackingNumber||"",admin_note:data.adminNote||"",updated_by:context.user.id};if(data.trackingUrl)patch.tracking_url=data.trackingUrl;return db.update(order.id,patch);
 });
export const createShopCheckoutSession = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({items:z.array(z.object({productId:z.string().min(1),quantity:z.number().int().min(1).max(10),size:z.string().max(40).optional(),color:z.string().max(40).optional()})).min(1).max(20)}))
 .handler(async({data,context})=>{
  const user=context.user,db=context.getBase44().asServiceRole.entities;
  if(!secrets.get("STRIPE_SECRET_KEY"))throw Object.assign(new Error("Online checkout is not active yet. The administrator must connect Stripe before orders can be paid."),{status:503,code:"SHOP_PAYMENTS_NOT_CONFIGURED"});
  if(!secrets.get("STRIPE_WEBHOOK_SECRET"))throw Object.assign(new Error("The signed Stripe webhook is not configured. Checkout remains disabled until payment events can be verified."),{status:503,code:"SHOP_WEBHOOK_NOT_CONFIGURED"});
  if(secrets.get("STRIPE_TAX_ENABLED")!=="true")throw Object.assign(new Error("Stripe Tax is not configured. The administrator must complete tax registration and Stripe Tax settings before checkout can be enabled."),{status:503,code:"SHOP_TAX_NOT_CONFIGURED"});
  const products=await Promise.all(data.items.map(x=>db.ShopProduct.get(x.productId).catch(()=>null)));
  const cart=data.items.map((line,i)=>({line,product:products[i]}));
  if(cart.some(x=>!x.product||x.product.status!=="published"||!["original","licensed"].includes(x.product.rights_status)))throw Object.assign(new Error("One or more products are no longer available for sale."),{status:409,code:"SHOP_PRODUCT_UNAVAILABLE"});
  if(cart.some(x=>x.product.product_type==="external"||x.product.vendor_type==="official_external"))throw Object.assign(new Error("Official external products must be purchased from their linked official retailer."),{status:400});
  const currencies=[...new Set(cart.map(x=>x.product.currency))];
  if(currencies.length!==1)throw Object.assign(new Error("Your bag contains different currencies. Checkout one currency at a time."),{status:400,code:"SHOP_MIXED_CURRENCIES"});
  for(const {line,product} of cart){
   if(product.product_type==="physical"&&Number(product.stock_quantity||0)<line.quantity)throw Object.assign(new Error("Not enough stock for "+product.title+"."),{status:409,code:"SHOP_OUT_OF_STOCK"});
   if((product.size_options||[]).length&&!line.size)throw Object.assign(new Error("Select a size for "+product.title+"."),{status:400});
   if(line.size&&!(product.size_options||[]).includes(line.size))throw Object.assign(new Error("The selected size is no longer available for "+product.title+"."),{status:409});
   if((product.color_options||[]).length&&!line.color)throw Object.assign(new Error("Select a colour for "+product.title+"."),{status:400});
   if(line.color&&!(product.color_options||[]).includes(line.color))throw Object.assign(new Error("The selected colour is no longer available for "+product.title+"."),{status:409});
  }
  const currency=currencies[0],items=cart.map(({line,product})=>({product_id:product.id,title:product.title,sku:product.sku||"",product_type:product.product_type,quantity:line.quantity,size:line.size||"",color:line.color||"",unit_price_cents:Number(product.price_cents),currency,image_url:product.image_url||"",shipping_required:!!product.shipping_required}));
  const subtotal=cart.reduce((sum,x)=>sum+Number(x.product.price_cents)*x.line.quantity,0);
  const shipping=cart.reduce((sum,x)=>sum+(x.product.product_type==="physical"&&x.product.shipping_required?Number(x.product.shipping_price_cents||0)*x.line.quantity:0),0);
  const total=subtotal+shipping;
  if(total<1)throw Object.assign(new Error("The order total must be greater than zero."),{status:400});
  const order=await db.ShopOrder.create({user_id:user.id,customer_email:user.email||"",customer_name:user.full_name||user.name||"",currency,items,subtotal_cents:subtotal,shipping_cents:shipping,tax_cents:0,total_cents:total,status:"pending_payment"});
  try{
   const form=new URLSearchParams();form.set("mode","payment");
   form.set("success_url",STRIPE_SITE_URL+"/shop?session_id={CHECKOUT_SESSION_ID}");
   form.set("cancel_url",STRIPE_SITE_URL+"/shop?checkout=cancelled");
   form.set("client_reference_id",user.id);if(user.email)form.set("customer_email",user.email);
   form.set("metadata[order_id]",order.id);form.set("metadata[user_id]",user.id);
   form.set("payment_intent_data[metadata][order_id]",order.id);form.set("payment_intent_data[metadata][user_id]",user.id);
   form.set("billing_address_collection","required");form.set("phone_number_collection[enabled]","true");form.set("automatic_tax[enabled]","true");
   if(cart.some(x=>x.product.product_type==="physical")){
    ["GB","US","CA","FR","DE","ES","IT","PT","BE","LU","NL","IE"].forEach((country,i)=>form.set("shipping_address_collection[allowed_countries]["+i+"]",country));
   }
   let index=0;
   for(const {line,product} of cart){
    const prefix="line_items["+index+"]";form.set(prefix+"[quantity]",String(line.quantity));
    form.set(prefix+"[price_data][currency]",currency.toLowerCase());
    form.set(prefix+"[price_data][unit_amount]",String(product.price_cents));
    form.set(prefix+"[price_data][product_data][name]",product.title);
    if(product.description)form.set(prefix+"[price_data][product_data][description]",product.description.slice(0,450));
    if(product.image_url)form.set(prefix+"[price_data][product_data][images][0]",product.image_url);
    index++;
   }
   if(shipping>0){
    const prefix="line_items["+index+"]";form.set(prefix+"[quantity]","1");
    form.set(prefix+"[price_data][currency]",currency.toLowerCase());form.set(prefix+"[price_data][unit_amount]",String(shipping));
    form.set(prefix+"[price_data][product_data][name]","Shipping");
   }
   const session=await stripeApi("checkout/sessions","POST",form);
   if(!session.url)throw new Error("Stripe did not return a checkout URL.");
   await db.ShopOrder.update(order.id,{stripe_session_id:session.id});
   return {url:session.url,orderId:order.id};
  }catch(error){
   await db.ShopOrder.update(order.id,{status:"payment_failed",admin_note:String(error.message||error).slice(0,900)}).catch(()=>null);
   throw error;
  }
 });
export const confirmShopCheckoutSession = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({sessionId:z.string().min(10).max(255)}))
 .handler(async({data,context})=>{
  const user=context.user,session=await stripeApi("checkout/sessions/"+encodeURIComponent(data.sessionId));
  if(session.client_reference_id!==user.id||session.metadata?.user_id!==user.id)throw Object.assign(new Error("This checkout session does not belong to your account."),{status:403});
  if(session.mode!=="payment"||session.status!=="complete"||session.payment_status!=="paid")throw Object.assign(new Error("Stripe has not confirmed this payment yet."),{status:409,code:"SHOP_PAYMENT_NOT_CONFIRMED"});
  const db=context.getBase44().asServiceRole.entities,order=await db.ShopOrder.get(session.metadata?.order_id||"").catch(()=>null);
  if(!order||order.user_id!==user.id||order.stripe_session_id!==session.id)throw Object.assign(new Error("The order linked to this payment could not be verified."),{status:403,code:"SHOP_ORDER_MISMATCH"});
  if(["paid","processing","shipped","delivered","paid_stock_issue"].includes(order.status))return {success:true,orderId:order.id,status:order.status};
  if(order.status==="payment_verifying")return {success:true,orderId:order.id,status:order.status};
  const claim=await db.ShopOrder.updateMany({id:order.id,status:"pending_payment"},{$set:{status:"payment_verifying"}});
  if(!claim?.updated){
   const latest=await db.ShopOrder.get(order.id).catch(()=>null);
   if(latest&&["paid","processing","shipped","delivered","paid_stock_issue","payment_verifying"].includes(latest.status))return {success:true,orderId:order.id,status:latest.status};
   throw Object.assign(new Error("Payment confirmation is already being processed. Refresh your order history shortly."),{status:409,code:"SHOP_PAYMENT_PROCESSING"});
  }
  let stockIssue=false;
  for(const item of order.items||[]){
   if(item.product_type!=="physical")continue;
   const result=await db.ShopProduct.updateMany({id:item.product_id,stock_quantity:{$gte:Number(item.quantity)}},{$inc:{stock_quantity:-Number(item.quantity)}});
   if(!result?.updated)stockIssue=true;
  }
  const shipping=session.shipping_details?.address||session.customer_details?.address||null;
  const updated=await db.ShopOrder.update(order.id,{
   status:stockIssue?"paid_stock_issue":"paid",paid_at:new Date().toISOString(),total_cents:Number(session.amount_total||order.total_cents),tax_cents:Number(session.total_details?.amount_tax||0),
   stripe_payment_intent_id:typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id||"",
   customer_email:session.customer_details?.email||order.customer_email,
   customer_name:session.shipping_details?.name||session.customer_details?.name||order.customer_name,
   shipping_address:shipping||{}
  });
  return {success:true,orderId:updated.id,status:updated.status};
 });

export const getSitePage = createServerFn({method:"GET"}).validator(z.object({slug:z.string().min(1),locale:z.enum(["en","fr","es","de","it","pt"]).default("en")})).handler(async({data,context})=>{
 const rows=await context.getBase44().asServiceRole.entities.SitePage.filter({slug:data.slug,locale:data.locale,status:"published"},"-updated_date",1,0);
 return rows[0]||null;
});
export const getAdminSitePages = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.SitePage.list("-updated_date",100,0);
});
export const saveSitePage = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),slug:z.string().min(2).max(160).regex(/^[a-z0-9-]+$/),title:z.string().min(2).max(180),content:z.string().max(30000),locale:z.enum(["en","fr","es","de","it","pt"]),status:z.enum(["draft","published"]),metaTitle:z.string().max(180).optional(),metaDescription:z.string().max(320).optional()}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities.SitePage;
  const p={slug:data.slug,title:data.title,content:data.content,locale:data.locale,status:data.status,meta_title:data.metaTitle||data.title,meta_description:data.metaDescription||"",updated_by:context.user.id};
  return data.id?db.update(data.id,p):db.create(p);
 });

export const getAdminSubscribers = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const monthKey=new Date().toISOString().slice(0,7);
 const [users,subscriptions,quotas,downloads,invoices]=await Promise.all([db.User.list("-created_date",5000,0),db.UserSubscription.list("-created_date",5000,0),db.DownloadQuota.filter({month_key:monthKey},"-created_date",5000,0),db.DownloadEvent.list("-created_date",5000,0),db.PlatformInvoice.list("-created_date",5000,0)]);
 const latestByUser=new Map();for(const sub of subscriptions){if(!latestByUser.has(sub.user_id))latestByUser.set(sub.user_id,sub);}
 const quotaByUser=new Map();for(const quota of quotas){if(!quotaByUser.has(quota.user_id))quotaByUser.set(quota.user_id,quota);}
 const downloadsByUser=new Map();for(const event of downloads){if(!downloadsByUser.has(event.user_id))downloadsByUser.set(event.user_id,[]);downloadsByUser.get(event.user_id).push(event);}
 const invoicesByUser=new Map();for(const invoice of invoices){if(!invoice.user_id)continue;if(!invoicesByUser.has(invoice.user_id))invoicesByUser.set(invoice.user_id,[]);invoicesByUser.get(invoice.user_id).push(invoice);}
 return users.map(user=>{const userDownloads=downloadsByUser.get(user.id)||[];const userInvoices=invoicesByUser.get(user.id)||[];return {id:user.id,email:user.email||"",full_name:user.full_name||"",role:user.role||"user",disabled:!!user.disabled,is_verified:!!user.is_verified,created_date:user.created_date||null,display_name:user.display_name||"",account_type:user.account_type||"viewer",country_code:user.country_code||"",country_name:user.country_name||"",account_notes:user.account_notes||"",subscription_tier:user.subscription_tier||"free",subscription_status:user.subscription_status||"inactive",subscription_currency:user.subscription_currency||"",subscription:latestByUser.get(user.id)||null,quota:quotaByUser.get(user.id)||null,download_count:userDownloads.length,recent_downloads:userDownloads.slice(0,10),invoice_count:userInvoices.length,recent_invoices:userInvoices.slice(0,10)};}).sort((a,b)=>String(b.created_date||"").localeCompare(String(a.created_date||"")));
});
export const adminInviteSubscriber = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({email:z.string().email().max(254)})).handler(async({data,context})=>{
 requireAdmin(context);await context.getBase44().users.inviteUser(data.email,"user");return {success:true,message:"Invitation sent. The recipient must complete the secure sign-up flow."};
});
export const adminResetSubscriberPassword = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({email:z.string().email().max(254)})).handler(async({data,context})=>{
 requireAdmin(context);await context.getBase44().auth.resetPasswordRequest(data.email);return {success:true,message:"If the account can receive reset messages, the secure reset email has been requested."};
});
export const adminUpdateSubscriber = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({userId:z.string().min(1),fullName:z.string().max(160).optional(),countryCode:z.union([z.string().regex(/^[A-Z]{2}$/),z.literal("")]).optional(),countryName:z.string().max(100).optional(),accountNotes:z.string().max(2000).optional(),accountType:z.enum(["viewer","creator"]).optional()})).handler(async({data,context})=>{
 requireAdmin(context);const patch={};if(data.fullName!==undefined)patch.full_name=data.fullName;if(data.countryCode!==undefined)patch.country_code=data.countryCode.toUpperCase();if(data.countryName!==undefined)patch.country_name=data.countryName;if(data.accountNotes!==undefined)patch.account_notes=data.accountNotes;if(data.accountType!==undefined)patch.account_type=data.accountType;return context.getBase44().asServiceRole.entities.User.update(data.userId,patch);
});
export const adminSetSubscriberAccess = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({userId:z.string().min(1),disabled:z.boolean()})).handler(async({data,context})=>{
 requireAdmin(context);if(data.userId===context.user.id&&data.disabled)throw Object.assign(new Error("You cannot suspend your own administrator account."),{status:400});return context.getBase44().asServiceRole.entities.User.update(data.userId,{disabled:data.disabled});
});
export const adminDeleteSubscriber = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({userId:z.string().min(1),confirmEmail:z.string().email()})).handler(async({data,context})=>{
 requireAdmin(context);
 if(data.userId===context.user.id)throw Object.assign(new Error("You cannot delete your own administrator account."),{status:400});
 const db=context.getBase44().asServiceRole.entities;
 const user=await db.User.get(data.userId);
 if(!user||String(user.email||"").toLowerCase()!==data.confirmEmail.toLowerCase())throw Object.assign(new Error("The account confirmation does not match."),{status:409});
 if(user.role==="admin")throw Object.assign(new Error("Administrator accounts cannot be deleted from the subscriber CRM."),{status:403});
 const subscriptions=await db.UserSubscription.filter({user_id:data.userId},"-created_date",100,0);
 if(subscriptions.some(x=>["active","trialing","past_due"].includes(x.status)))throw Object.assign(new Error("Cancel or resolve the active billing subscription before deleting this account."),{status:409});
 const removeRecords=async(entity,filter)=>{const collection=db[entity];if(!collection?.filter||!collection?.delete)return;const rows=await collection.filter(filter,"-created_date",5000,0);for(const row of rows)await collection.delete(row.id);};
 const jobs=[
  ["DownloadQuota",{user_id:data.userId}],["DownloadEvent",{user_id:data.userId}],
  ["SocialPost",{user_id:data.userId}],["AIContentDraft",{user_id:data.userId}],
  ["CreatorProfile",{user_id:data.userId}],["UserNotification",{user_id:data.userId}],
  ["DirectMessage",{sender_id:data.userId}],["DirectMessage",{recipient_id:data.userId}],
  ["UserBlock",{blocker_id:data.userId}],["UserBlock",{blocked_id:data.userId}],
  ["ForumPost",{author_id:data.userId}],["ForumThread",{author_id:data.userId}],
  ["ForumReaction",{user_id:data.userId}],["MarketplaceInquiry",{buyer_id:data.userId}],
  ["MarketplaceInquiry",{seller_id:data.userId}],["MarketplaceListing",{seller_id:data.userId}],
  ["ContentReport",{reporter_id:data.userId}],["PlatformInvoice",{user_id:data.userId,status:"draft"}]
 ];
 for(const [entity,filter] of jobs)await removeRecords(entity,filter);
 const ownedVideos=await db.Video.filter({uploaded_by:data.userId},"-created_date",5000,0);
 for(const video of ownedVideos)await db.Video.update(video.id,{uploaded_by:"deleted-account"});
 for(const subscription of subscriptions)await db.UserSubscription.update(subscription.id,{user_id:"deleted:"+data.userId});
 await Promise.all([db.PlatformInvoice.updateMany({user_id:data.userId},{$set:{user_id:"deleted:"+data.userId}}),db.PaymentLedgerEntry.updateMany({user_id:data.userId},{$set:{user_id:"deleted:"+data.userId}})]);
 await db.User.delete(data.userId);
 return {success:true,message:"App user deleted. Associated personal profile and operational records removed; non-draft invoices, payment ledger and anonymised subscription history retained for accounting."};
});
export const getAdminPromotions = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.SubscriberPromotion.list("-created_date",500,0);});
export const saveAdminPromotion = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({id:z.string().optional(),name:z.string().min(2).max(120),code:z.string().min(3).max(40).transform(v=>v.toUpperCase()),discountPercent:z.number().min(1).max(100),targetTiers:z.array(z.enum(["free","starter","pro","premium"])),targetCountries:z.array(z.string().length(2)),startsAt:z.string().optional(),endsAt:z.string().optional(),maxRedemptions:z.number().int().min(0),status:z.enum(["draft","active","paused","expired"]),internalNote:z.string().max(1000).optional()})).handler(async({data,context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities.SubscriberPromotion;const record={name:data.name,code:data.code,discount_percent:data.discountPercent,target_tiers:data.targetTiers,target_countries:data.targetCountries.map(x=>x.toUpperCase()),...(data.startsAt?{starts_at:data.startsAt}:{}),...(data.endsAt?{ends_at:data.endsAt}:{}),max_redemptions:data.maxRedemptions,status:data.status,internal_note:data.internalNote||""};return data.id?db.update(data.id,record):db.create(record);
});
export const getAdminInvoiceSettings = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);const rows=await context.getBase44().asServiceRole.entities.InvoiceSettings.list("-created_date",1,0);return rows[0]||{legal_entity_name:"",company_number:"",registered_address:"",vat_number:"",vat_registered:false,invoice_prefix:"VH",next_sequence:1,default_currency:"GBP",payment_terms_days:14,logo_url:"",legal_email:"",footer_text:"",tax_treatment_default:"unknown"};});
export const saveAdminInvoiceSettings = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({id:z.string().optional(),legalEntityName:z.string().max(180),companyNumber:z.string().max(80),registeredAddress:z.string().max(1000),vatNumber:z.string().max(80).optional(),vatRegistered:z.boolean(),invoicePrefix:z.string().min(1).max(24),nextSequence:z.number().int().min(1),defaultCurrency:z.enum(["GBP","EUR","USD"]),paymentTermsDays:z.number().int().min(0).max(365),logoUrl:z.string().url().max(1000).optional().or(z.literal("")),legalEmail:z.string().email().max(254).optional().or(z.literal("")),footerText:z.string().max(2000),taxTreatmentDefault:z.enum(["unknown","not_applicable","outside_scope","reverse_charge","standard_rate","zero_rate"])})).handler(async({data,context})=>{requireAdmin(context);if(data.vatRegistered&&!data.vatNumber?.trim())throw Object.assign(new Error("A VAT registration number is required when VAT registration is marked as active."),{status:400});const db=context.getBase44().asServiceRole.entities.InvoiceSettings;const payload={legal_entity_name:data.legalEntityName,company_number:data.companyNumber,registered_address:data.registeredAddress,vat_number:data.vatNumber||"",vat_registered:data.vatRegistered,invoice_prefix:data.invoicePrefix,next_sequence:data.nextSequence,default_currency:data.defaultCurrency,payment_terms_days:data.paymentTermsDays,...(data.logoUrl?{logo_url:data.logoUrl}:{}),legal_email:data.legalEmail||"",footer_text:data.footerText,tax_treatment_default:data.taxTreatmentDefault};const rows=await db.list("-created_date",1,0);return rows[0]?db.update(rows[0].id,payload):db.create(payload);});
export const getAdminInvoices = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.PlatformInvoice.list("-created_date",1000,0);});
export const saveAdminInvoiceDraft = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({id:z.string().optional(),userId:z.string().optional(),customerName:z.string().max(160).optional(),customerEmail:z.union([z.string().email().max(254),z.literal("")]).optional(),customerAddress:z.string().max(1000).optional(),customerCountry:z.string().length(2).optional(),currency:z.enum(["GBP","EUR","USD"]),description:z.string().min(3).max(1000),subtotalCents:z.number().int().min(0),taxCents:z.number().int().min(0),taxRatePercent:z.number().min(0).max(100),taxTreatment:z.enum(["not_applicable","outside_scope","reverse_charge","standard_rate","zero_rate","unknown"]),internalNote:z.string().max(1000).optional()})).handler(async({data,context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities.PlatformInvoice;const record={user_id:data.userId||"",customer_name:data.customerName||"",customer_email:data.customerEmail||"",customer_address:data.customerAddress||"",customer_country:data.customerCountry||"",currency:data.currency,description:data.description,subtotal_cents:data.subtotalCents,tax_cents:data.taxCents,total_cents:data.subtotalCents+data.taxCents,tax_rate_percent:data.taxRatePercent,tax_treatment:data.taxTreatment,status:"draft",internal_note:data.internalNote||""};if(data.id){const current=await db.get(data.id);if(current.status!=="draft")throw Object.assign(new Error("Only draft invoices can be edited."),{status:409});return db.update(data.id,record);}return db.create(record);
});
export const getAdminVideoIntelligence = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const [videos,metrics]=await Promise.all([db.Video.list("-created_date",2000,0),db.VideoPerformanceMetric.list("-created_date",5000,0)]);const byVideo=new Map();for(const metric of metrics){if(!byVideo.has(metric.video_id))byVideo.set(metric.video_id,[]);byVideo.get(metric.video_id).push(metric);}return videos.map(video=>{const rows=byVideo.get(video.id)||[];const totals=rows.reduce((a,m)=>({views:a.views+(Number(m.views)||0),impressions:a.impressions+(Number(m.impressions)||0),likes:a.likes+(Number(m.likes)||0),comments:a.comments+(Number(m.comments)||0),shares:a.shares+(Number(m.shares)||0),saves:a.saves+(Number(m.saves)||0),watchWeighted:a.watchWeighted+(Number(m.average_watch_seconds)||0)*(Number(m.views)||0),watchViews:a.watchViews+(Number(m.views)||0),length:Number(m.video_length_seconds)||a.length}),{views:0,impressions:0,likes:0,comments:0,shares:0,saves:0,watchWeighted:0,watchViews:0,length:Number(video.duration_seconds)||0});const platformBreakdown=[...new Set(rows.map(m=>m.platform))].map(platform=>{const pr=rows.filter(m=>m.platform===platform);const pt=pr.reduce((a,m)=>({views:a.views+(Number(m.views)||0),impressions:a.impressions+(Number(m.impressions)||0),likes:a.likes+(Number(m.likes)||0),comments:a.comments+(Number(m.comments)||0),shares:a.shares+(Number(m.shares)||0),saves:a.saves+(Number(m.saves)||0),watchWeighted:a.watchWeighted+(Number(m.average_watch_seconds)||0)*(Number(m.views)||0),watchViews:a.watchViews+(Number(m.views)||0),length:Number(m.video_length_seconds)||a.length}),{views:0,impressions:0,likes:0,comments:0,shares:0,saves:0,watchWeighted:0,watchViews:0,length:Number(video.duration_seconds)||0});const actions=pt.likes+pt.comments+pt.shares+pt.saves;return {platform,views:pt.views,shares:pt.shares,engagementRate:pt.views?actions/pt.views*100:null,shareRate:pt.views?pt.shares/pt.views*100:null,retentionRate:pt.length&&pt.watchViews?Math.min(100,pt.watchWeighted/pt.watchViews/pt.length*100):null,records:pr.length};});const interactions=totals.likes+totals.comments+totals.shares+totals.saves;const engagementRate=totals.views?interactions/totals.views*100:null;const shareRate=totals.views?totals.shares/totals.views*100:null;const retentionRate=totals.length&&totals.watchViews?Math.min(100,totals.watchWeighted/totals.watchViews/totals.length*100):null;const scoreAvailable=totals.views>=1000&&engagementRate!==null&&shareRate!==null&&retentionRate!==null;const potentialScore=scoreAvailable?Math.round(Math.min(100,engagementRate/12*100)*.35+Math.min(100,shareRate/4*100)*.4+Math.min(100,retentionRate/80*100)*.25):null;const scoreConfidence=potentialScore===null?"insufficient_data":rows.length>=10&&totals.views>=100000?"higher_sample":rows.length>=4&&totals.views>=10000?"medium_sample":"low_sample";return {...video,metrics:totals,platformBreakdown,engagementRate,shareRate,retentionRate,potentialScore,scoreConfidence,metricRows:rows.length};}).sort((a,b)=>(b.metrics.shares-a.metrics.shares)||(b.metrics.views-a.metrics.views));
});
export const saveVideoPerformanceMetric = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({videoId:z.string().min(1),platform:z.enum(["TikTok","Instagram","YouTube","Other"]),periodStart:z.string().optional(),periodEnd:z.string().optional(),views:z.number().int().min(0),impressions:z.number().int().min(0),likes:z.number().int().min(0),comments:z.number().int().min(0),shares:z.number().int().min(0),saves:z.number().int().min(0),averageWatchSeconds:z.number().min(0),videoLengthSeconds:z.number().min(0),profileClicks:z.number().int().min(0),followersGained:z.number().int().min(0)})).handler(async({data,context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const video=await db.Video.get(data.videoId).catch(()=>null);if(!video)throw Object.assign(new Error("The selected video no longer exists."),{status:404});if(data.impressions&&data.views>data.impressions*10)throw Object.assign(new Error("Views are inconsistent with impressions; check the source metrics."),{status:400});return db.VideoPerformanceMetric.create({video_id:data.videoId,platform:data.platform,...(data.periodStart?{period_start:data.periodStart}:{}),...(data.periodEnd?{period_end:data.periodEnd}:{}),views:data.views,impressions:data.impressions,likes:data.likes,comments:data.comments,shares:data.shares,saves:data.saves,average_watch_seconds:data.averageWatchSeconds,video_length_seconds:data.videoLengthSeconds,profile_clicks:data.profileClicks,followers_gained:data.followersGained,source:"manual"});
});
export const getAdminFinanceSnapshot = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const [subscriptions,plans,invoices,promotions,payments]=await Promise.all([db.UserSubscription.list("-created_date",5000,0),db.SubscriptionPlan.list("sort_order",500,0),db.PlatformInvoice.list("-created_date",1000,0),db.SubscriberPromotion.list("-created_date",500,0),db.PaymentLedgerEntry.list("-created_date",5000,0)]);
 const active=subscriptions.filter(s=>s.status==="active"||s.status==="trialing"||(s.status==="past_due"&&s.grace_period_ends_at&&new Date(s.grace_period_ends_at)>new Date()));const currencies=["GBP","EUR","USD"].map(currency=>{const rows=active.filter(s=>s.currency===currency);return {currency,subscriptions:rows.length,mrrCents:rows.reduce((sum,s)=>sum+Math.max(0,Number(s.current_monthly_price_cents)||0),0)};});
 const paid=payments.filter(p=>p.status==="paid"||p.status==="refunded");const currentYear=new Date().getUTCFullYear();const monthlyRevenue=Array.from({length:12},(_,month)=>({month:month+1,label:new Date(Date.UTC(currentYear,month,1)).toLocaleString("en-GB",{month:"short",timeZone:"UTC"}),GBP:0,EUR:0,USD:0}));for(const p of paid){const d=new Date(p.paid_at||p.created_date);if(!Number.isFinite(d.getTime())||d.getUTCFullYear()!==currentYear)continue;const c=p.currency;if(["GBP","EUR","USD"].includes(c))monthlyRevenue[d.getUTCMonth()][c]+=Math.max(0,Number(p.amount_paid_cents||0)-Number(p.refund_amount_cents||0));}
 const yearlyRevenue=[currentYear-2,currentYear-1,currentYear].map(year=>({year,GBP:0,EUR:0,USD:0}));for(const p of paid){const d=new Date(p.paid_at||p.created_date);const row=yearlyRevenue.find(x=>x.year===d.getUTCFullYear());if(row&&["GBP","EUR","USD"].includes(p.currency))row[p.currency]+=Math.max(0,Number(p.amount_paid_cents||0)-Number(p.refund_amount_cents||0));}
 const paidTotals=["GBP","EUR","USD"].map(currency=>({currency,totalCents:paid.filter(p=>p.currency===currency).reduce((sum,p)=>sum+Number(p.amount_paid_cents||0),0)}));const refunds=["GBP","EUR","USD"].map(currency=>({currency,totalCents:payments.filter(p=>p.currency===currency).reduce((sum,p)=>sum+Number(p.refund_amount_cents||0),0)}));
 return {activeSubscriptions:active.length,plansCount:plans.length,promotionCount:promotions.length,draftInvoices:invoices.filter(i=>i.status==="draft").length,paidInvoiceCount:paid.length,paidInvoiceTotals:paidTotals,refundTotals:refunds,paymentCount:payments.length,recentPayments:payments.slice(0,100),paymentLedger:payments,monthlyRevenue,yearlyRevenue,byCurrency:currencies,mrrLabel:currencies.some(x=>x.mrrCents>0)?currencies.filter(x=>x.mrrCents>0).map(x=>new Intl.NumberFormat("en-GB",{style:"currency",currency:x.currency}).format(x.mrrCents/100)).join(" + "):"0",stripeConfigured:Boolean(secrets.get("STRIPE_SECRET_KEY")),stripeWebhookConfigured:Boolean(secrets.get("STRIPE_WEBHOOK_SECRET")),accountingRevenueAvailable:paid.length>0};
});

export const getAdminOverview = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
 const [users,news,products,reports,downloads,videos,subscriptions]=await Promise.all([
  db.User.list("-created_date",5000,0),
  db.NewsArticle.list("-created_date",200,0),db.ShopProduct.list("-created_date",200,0),
  db.ContentReport.filter({status:"open"},"-created_date",100,0),db.DownloadEvent.list("-created_date",1000,0),
  db.Video.list("-created_date",2000,0),db.UserSubscription.list("-created_date",2000,0)
 ]);
 return {users:users.length,news:news.length,publishedNews:news.filter(x=>x.status==="published").length,products:products.length,openReports:reports.length,downloads:downloads.length,videos:videos.length,publishedVideos:videos.filter(x=>x.status==="published"&&x.license_status==="verified").length,activeSubscriptions:subscriptions.filter(x=>x.status==="active"||x.status==="trialing").length};
});

export const getAdminAnalytics = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);
 const db=context.getBase44().asServiceRole.entities;
 const [users,downloads,subscriptions,payments,videos,sources,articles,videoMetrics]=await Promise.all([
  db.User.list("-created_date",5000,0),
  db.DownloadEvent.list("-created_date",5000,0),
  db.UserSubscription.list("-created_date",5000,0),
  db.PaymentLedgerEntry.list("-created_date",5000,0),
  db.Video.list("-created_date",3000,0),
  db.NewsSource.list("-created_date",200,0),
  db.NewsArticle.list("-created_date",3000,0),
  db.VideoPerformanceMetric.list("-created_date",5000,0)
 ]);
 const now=Date.now(),cutoff=now-30*86400000,dayMs=86400000;
 const dateOf=(x)=>{const d=new Date(x?.created_date||x?.created_at||x?.paid_at||x?.period_start||0);return Number.isFinite(d.getTime())?d.getTime():0;};
 const recent=(rows)=>rows.filter(x=>dateOf(x)>=cutoff);
 const active=subscriptions.filter(x=>x.status==="active"||x.status==="trialing"||(x.status==="past_due"&&x.grace_period_ends_at&&new Date(x.grace_period_ends_at).getTime()>now));
 const byTier=["free","starter","pro","premium"].map(tier=>({tier,count:subscriptions.filter(x=>x.tier_code===tier&&x.status!=="cancelled").length,active:active.filter(x=>x.tier_code===tier).length}));
 const revenueByCurrency=["GBP","EUR","USD"].map(currency=>{const rows=payments.filter(x=>x.currency===currency&&(x.status==="paid"||x.status==="refunded"));return {currency,transactions:rows.length,grossCents:rows.reduce((n,x)=>n+Number(x.amount_paid_cents||0),0),refundCents:rows.reduce((n,x)=>n+Number(x.refund_amount_cents||0),0),netCents:rows.reduce((n,x)=>n+Math.max(0,Number(x.amount_paid_cents||0)-Number(x.refund_amount_cents||0)),0)};});
 const startDay=new Date(now-29*dayMs);startDay.setUTCHours(0,0,0,0);
 const daily=Array.from({length:30},(_,i)=>{const d=new Date(startDay.getTime()+i*dayMs);return {date:d.toISOString().slice(0,10),registrations:0,downloads:0,paidTransactions:0};});
 const dayIndex=(value)=>{const t=dateOf(value);if(!t)return -1;const midnight=new Date(t);midnight.setUTCHours(0,0,0,0);const i=Math.floor((midnight.getTime()-startDay.getTime())/dayMs);return i>=0&&i<30?i:-1;};
 for(const x of users){const i=dayIndex(x);if(i>=0)daily[i].registrations++;}
 for(const x of downloads){const i=dayIndex(x);if(i>=0&&x.status==="signed")daily[i].downloads++;}
 for(const x of payments){const i=dayIndex(x);if(i>=0&&x.status==="paid")daily[i].paidTransactions++;}
 const recentVideoMetrics=videoMetrics.filter(x=>{const t=new Date(x.period_start||x.created_date||0).getTime();return Number.isFinite(t)&&t>=cutoff&&t<=now;});
 const metricPlatforms=["TikTok","Instagram","YouTube","Other"].map(platform=>{const rows=recentVideoMetrics.filter(x=>x.platform===platform);const views=rows.reduce((n,x)=>n+Number(x.views||0),0);const likes=rows.reduce((n,x)=>n+Number(x.likes||0),0);const comments=rows.reduce((n,x)=>n+Number(x.comments||0),0);const shares=rows.reduce((n,x)=>n+Number(x.shares||0),0);const saves=rows.reduce((n,x)=>n+Number(x.saves||0),0);const watched=rows.reduce((n,x)=>n+Number(x.average_watch_seconds||0)*Number(x.views||0),0);return {platform,records:rows.length,views,likes,comments,shares,saves,engagementRate:views?((likes+comments+shares+saves)/views)*100:0,averageWatchSeconds:views?watched/views:0,sourceApi:rows.filter(x=>x.source==="api").length,sourceManual:rows.filter(x=>x.source==="manual").length};});
 const videoMap=new Map(videos.map(v=>[v.id,v.title]));
 const topVideos=recentVideoMetrics.reduce((acc,x)=>{const id=x.video_id||"unknown";const row=acc.get(id)||{videoId:id,title:videoMap.get(id)||"Video removed",views:0,likes:0,comments:0,shares:0,records:0};row.views+=Number(x.views||0);row.likes+=Number(x.likes||0);row.comments+=Number(x.comments||0);row.shares+=Number(x.shares||0);row.records++;acc.set(id,row);return acc;},new Map());
 const sourceStatus=sources.map(x=>({name:x.name,enabled:Boolean(x.enabled),lastCheckedAt:x.last_checked_at||null,lastStatus:x.last_status||"Not checked"}));
 return {
  generatedAt:new Date(now).toISOString(),coverage:{users:users.length,downloads:downloads.length,subscriptions:subscriptions.length,paymentRecords:payments.length,videos:videos.length,videoMetricRecords:videoMetrics.length,videoMetricRecords30d:recentVideoMetrics.length,apiMetricRecords:videoMetrics.filter(x=>x.source==="api").length,manualMetricRecords:videoMetrics.filter(x=>x.source==="manual").length,newsArticles:articles.length,publishedArticles:articles.filter(x=>x.status==="published").length},
  growth:{newUsers30d:recent(users).length,downloads30d:recent(downloads).filter(x=>x.status==="signed").length,paidTransactions30d:recent(payments).filter(x=>x.status==="paid").length,daily},
  subscriptions:{active:active.length,trialing:subscriptions.filter(x=>x.status==="trialing").length,pastDue:subscriptions.filter(x=>x.status==="past_due").length,cancelled:subscriptions.filter(x=>x.status==="cancelled").length,byTier},
  revenueByCurrency,
  videoPerformance:{records:videoMetrics.length,totals:metricPlatforms.reduce((a,x)=>({views:a.views+x.views,likes:a.likes+x.likes,comments:a.comments+x.comments,shares:a.shares+x.shares,saves:a.saves+x.saves}),{views:0,likes:0,comments:0,shares:0,saves:0}),byPlatform:metricPlatforms,topVideos:[...topVideos.values()].sort((a,b)=>b.views-a.views).slice(0,10)},
  editorial:{sourcesEnabled:sources.filter(x=>x.enabled).length,sourcesNeverChecked:sources.filter(x=>x.enabled&&!x.last_checked_at).length,sourcesWithErrors:sources.filter(x=>x.enabled&&/error|failed|http [45]\d\d/i.test(x.last_status||"")).length,sourceStatus,publishedArticles:articles.filter(x=>x.status==="published").length,draftArticles:articles.filter(x=>x.status==="draft").length}
 };
});
export const getAdminReports = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.ContentReport.list("-created_date",100,0);
});
export const getPlatformReadiness = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);
 const db=context.getBase44().asServiceRole.entities;
 const [sources,agents,plans]=await Promise.all([
  db.NewsSource.filter({enabled:true},"-created_date",100,0),
  db.AIAgentConfig.list("-created_date",100,0),
  db.SubscriptionPlan.list("-created_date",100,0)
 ]);
 const storageSecrets=["VIDEO_STORAGE_ENDPOINT","VIDEO_STORAGE_BUCKET","VIDEO_STORAGE_ACCESS_KEY_ID","VIDEO_STORAGE_SECRET_ACCESS_KEY"].every(name=>Boolean(secrets.get(name)));
 const stripeSecret=Boolean(secrets.get("STRIPE_SECRET_KEY"));
 const stripeWebhook=Boolean(secrets.get("STRIPE_WEBHOOK_SECRET"));
 const tiktokConfigured=Boolean(secrets.get("TIKTOK_CLIENT_KEY")&&secrets.get("TIKTOK_CLIENT_SECRET"));
 const instagramConfigured=Boolean(secrets.get("META_APP_ID")&&secrets.get("META_APP_SECRET"));
 const youtubeConfigured=Boolean(secrets.get("GOOGLE_CLIENT_ID")&&secrets.get("GOOGLE_CLIENT_SECRET"));
 const xOauthConfigured=Boolean(secrets.get("X_CLIENT_ID")&&secrets.get("X_CLIENT_SECRET"));
 const linkedinConfigured=Boolean(secrets.get("LINKEDIN_CLIENT_ID")&&secrets.get("LINKEDIN_CLIENT_SECRET"));
 const socialEncryptionConfigured=Boolean(secrets.get("SOCIAL_TOKEN_ENCRYPTION_KEY")&&secrets.get("SOCIAL_OAUTH_STATE_SECRET"));
 return {
  aiProviderConfigured:Boolean(secrets.get("OMNIROUTE_API_KEY")&&secrets.get("OMNIROUTE_BASE_URL")),
  omniRouteConfigured:Boolean(secrets.get("OMNIROUTE_API_KEY")&&secrets.get("OMNIROUTE_BASE_URL")),
  xApiConfigured:Boolean(secrets.get("X_BEARER_TOKEN")),
  enabledNewsSources:sources.length,
  agentTemplates:agents.length,
  enabledAgents:agents.filter(x=>x.enabled).length,
  draftPlans:plans.filter(x=>x.status==="draft").length,
  activePlans:plans.filter(x=>x.status==="active").length,
  videoStorage:storageSecrets?"configured":"missing_credentials",
  stripeSecretConfigured:stripeSecret,
  stripeWebhookConfigured:stripeWebhook,
  payments:stripeSecret&&stripeWebhook?"configured":stripeSecret?"webhook_secret_missing":"missing_credentials",
  socialEncryptionConfigured,
  socialPublishing:{tiktokConfigured,instagramConfigured,facebookConfigured:instagramConfigured,youtubeConfigured,xOauthConfigured,linkedinConfigured},
  recurringAgentScheduler:"manual_only"
 };
});
export const updateReportStatus = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string(),status:z.enum(["reviewing","resolved","dismissed"])}))
 .handler(async({data,context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.ContentReport.update(data.id,{status:data.status});});

async function omniRouteChat({messages, model, temperature = 0.4, maxTokens = 1800, title = "VICEHUB"}) {
 const key=secrets.get("OMNIROUTE_API_KEY"),base=secrets.get("OMNIROUTE_BASE_URL");
 if(!key||!base)throw Object.assign(new Error("OmniRoute is not configured. Add OMNIROUTE_API_KEY and OMNIROUTE_BASE_URL (OpenAI-compatible /v1 base URL) to Base44 secrets."),{status:503,code:"OMNIROUTE_NOT_CONFIGURED"});
 const selectedModel=model||secrets.get("OMNIROUTE_MODEL")||"auto";
 const response=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","X-Title":title},body:JSON.stringify({model:selectedModel,messages,temperature,max_tokens:maxTokens})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(new Error(payload.error?.message||"OmniRoute returned HTTP "+response.status),{status:502,code:"OMNIROUTE_REQUEST_FAILED"});
 const output=payload.choices?.[0]?.message?.content;
 if(!output)throw Object.assign(new Error("OmniRoute returned an empty response."),{status:502,code:"OMNIROUTE_EMPTY_RESPONSE"});
 return {output,model:payload.model||selectedModel,usage:payload.usage||null};
}

export const testOmniRouteConnection = createServerFn({method:"POST"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);
 const started=Date.now();
 const result=await omniRouteChat({
  messages:[{role:"user",content:"Reply with exactly VICEHUB_OMNIROUTE_OK"}],
  temperature:0,
  maxTokens:16,
  title:"VICEHUB Admin health check"
 });
 if(!result.output.trim().includes("VICEHUB_OMNIROUTE_OK"))throw Object.assign(new Error("OmniRoute responded, but the health-check response was invalid."),{status:502,code:"OMNIROUTE_HEALTHCHECK_INVALID"});
 return {ok:true,model:result.model,latencyMs:Date.now()-started};
});

export const generateStudioDraft = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({platform:z.enum(["TikTok","Instagram","Facebook","YouTube","X","LinkedIn","General"]),contentType:z.enum(["Title","Hook","Caption","Description","Hashtags","Script","SEO","GEO"]),topic:z.string().min(5).max(1000),tone:z.enum(["Cinematic","Energetic","Informative","Professional"]).default("Energetic"),language:z.enum(["English","French","Spanish","German","Italian","Portuguese"]).default("English")}))
 .handler(async({data,context})=>{
  const prompt="You are a professional GTA VI creator marketing assistant. Generate "+data.contentType+" for "+data.platform+". Topic: "+data.topic+". Tone: "+data.tone+". Language: "+data.language+". Keep claims factual, never present leaks or rumours as confirmed, and do not imply affiliation with Rockstar Games. Return only usable content.";
  const generated=await omniRouteChat({messages:[{role:"user",content:prompt}],temperature:0.7,maxTokens:1400,title:"VICEHUB Creator Studio"});
  const output=generated.output,model=generated.model;
  const saved=await context.getBase44().asServiceRole.entities.AIContentDraft.create({user_id:context.user.id,platform:data.platform,content_type:data.contentType,topic:data.topic,output,status:"draft",provider:model});
  return {output,id:saved.id,model};
 });
export const getMyStudioDrafts = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 return context.getBase44().asServiceRole.entities.AIContentDraft.filter({user_id:context.user.id},"-created_date",30,0);
});

export const getAdminAgents = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.AIAgentConfig.list("-created_date",50,0);});
export const saveAdminAgent = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),agentKey:z.enum(["news_editor","seo_agent","geo_agent","social_agent","platform_analyst"]),displayName:z.string().min(2).max(100),instructions:z.string().max(10000),providerModel:z.string().max(120),enabled:z.boolean(),schedule:z.enum(["manual","hourly","daily","weekly"]),monthlyRunLimit:z.number().int().min(0)}))
 .handler(async({data,context})=>{requireAdmin(context);const db=context.getBase44().asServiceRole.entities.AIAgentConfig;const p={agent_key:data.agentKey,display_name:data.displayName,instructions:data.instructions,provider_model:data.providerModel,enabled:data.enabled,schedule:data.schedule,monthly_run_limit:data.monthlyRunLimit};return data.id?db.update(data.id,p):db.create(p);});

export const getSocialProviderAvailability = createServerFn({method:"GET"}).middleware([requireUser]).handler(async()=>{
 const meta=Boolean(secrets.get("META_APP_ID")&&secrets.get("META_APP_SECRET"));
 return {
  TikTok:Boolean(secrets.get("TIKTOK_CLIENT_KEY")&&secrets.get("TIKTOK_CLIENT_SECRET")),
  Instagram:meta,
  Facebook:meta,
  YouTube:Boolean(secrets.get("GOOGLE_CLIENT_ID")&&secrets.get("GOOGLE_CLIENT_SECRET")),
  X:Boolean(secrets.get("X_CLIENT_ID")&&secrets.get("X_CLIENT_SECRET")),
  LinkedIn:Boolean(secrets.get("LINKEDIN_CLIENT_ID")&&secrets.get("LINKEDIN_CLIENT_SECRET")),
  omniRouteConfigured:Boolean(secrets.get("OMNIROUTE_API_KEY")&&secrets.get("OMNIROUTE_BASE_URL"))
 };
});

export const getMySocialPosts = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>context.getBase44().asServiceRole.entities.SocialPost.filter({user_id:context.user.id},"-created_date",100,0));
export const saveSocialPost = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),platform:z.enum(["TikTok","Instagram","Facebook","YouTube","X","LinkedIn"]),caption:z.string().min(1).max(5000),accountId:z.string().optional(),mediaUrl:z.string().url().max(500).optional(),mediaObjectKey:z.string().max(500).optional(),scheduledAt:z.string().datetime().optional()}))
 .handler(async({data,context})=>{const db=context.getBase44().asServiceRole.entities; if(data.scheduledAt&&new Date(data.scheduledAt)<=new Date())throw Object.assign(new Error("Choose a future date for scheduled publication."),{status:400}); if(data.mediaUrl&&data.mediaObjectKey)throw Object.assign(new Error("Choose either an uploaded video or a public video URL, not both."),{status:400}); if(data.mediaObjectKey&&!data.mediaObjectKey.startsWith("social/"+context.user.id+"/"))throw Object.assign(new Error("The uploaded media file does not belong to your account."),{status:403}); if(data.platform==="LinkedIn"&&(data.mediaUrl||data.mediaObjectKey))throw Object.assign(new Error("LinkedIn text publishing is enabled in this release; video and image uploads are not enabled yet."),{status:400}); if(data.accountId){const account=await db.SocialAccount.get(data.accountId).catch(()=>null);if(!account||account.user_id!==context.user.id||account.provider!==data.platform||account.status!=="connected")throw Object.assign(new Error("Select a connected account belonging to your user and matching the chosen network."),{status:403});} const mediaReference=data.mediaObjectKey||data.mediaUrl||""; const p={user_id:context.user.id,platform:data.platform,caption:data.caption,account_id:data.accountId||"",media_type:mediaReference?"video":"none",media_reference:mediaReference,status:data.scheduledAt?"scheduled":"draft",...(data.scheduledAt?{scheduled_at:data.scheduledAt}:{})}; const posts=db.SocialPost;if(data.id){const existing=await posts.get(data.id).catch(()=>null);if(!existing||existing.user_id!==context.user.id||existing.status==="published"||existing.status==="publishing")throw Object.assign(new Error("Only your own unpublished drafts can be edited."),{status:403});return posts.update(existing.id,p);}return posts.create(p);});
export const deleteSocialPost = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({postId:z.string().min(1)}))
 .handler(async({data,context})=>{const db=context.getBase44().asServiceRole.entities.SocialPost;const post=await db.get(data.postId).catch(()=>null);if(!post||post.user_id!==context.user.id)throw Object.assign(new Error("You can only delete your own social posts."),{status:403});if(["published","publishing"].includes(post.status))throw Object.assign(new Error("Published or processing posts cannot be deleted from the publication history."),{status:409});if(post.media_reference?.startsWith("social/"+context.user.id+"/")){try{const deleteUrl=await presignR2({method:"DELETE",objectKey:post.media_reference,expiresIn:60});await fetch(deleteUrl,{method:"DELETE"});}catch{}}await db.delete(post.id);return {success:true};});
export const getMyMarketplaceInquiries = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 const db=context.getBase44().asServiceRole.entities;const [buyer,seller]=await Promise.all([db.MarketplaceInquiry.filter({buyer_id:context.user.id},"-created_date",50,0),db.MarketplaceInquiry.filter({seller_id:context.user.id},"-created_date",50,0)]);return {buyer,seller};
});

export const seedPlatformDefaults = createServerFn({method:"POST"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
 const categories=[]; // Community/forum taxonomy is intentionally on hold for the later launch phase.
 let categoryCount=0;
 for(let i=0;i<categories.length;i++){const [name,slug,description]=categories[i];const exists=await db.ForumCategory.filter({slug},"created_date",1,0);if(!exists.length){await db.ForumCategory.create({name,slug,description,sort_order:i,status:"active"});categoryCount++;}}
 const templates=[
 ["terms","Terms of Service","DRAFT FOR LEGAL REVIEW — Replace this template with jurisdiction-specific terms before publishing. Define the contracting entity and registered address; eligibility and account rules; acceptable use; user-generated content licences; prohibited content; intellectual property; moderation and suspension; service availability; disclaimers; liability limits; governing law and dispute resolution. Do not publish until reviewed by qualified UK counsel."],
 ["privacy","Privacy Policy","DRAFT FOR LEGAL REVIEW — Identify the controller and contact details; list personal data collected; explain purposes and lawful bases under UK GDPR and applicable EU GDPR; identify processors and international transfers; set retention periods; explain user rights and complaint routes; describe security measures and cookies; provide a contact route. Complete a data map and processor list before publication."],
 ["cookies","Cookie Policy","DRAFT FOR LEGAL REVIEW — Inventory every cookie and similar technology, its purpose, provider, duration and category. Obtain prior consent for non-essential cookies where required. Provide granular choices, withdrawal and a link to the preference centre. Verify the actual deployed scripts before publishing."],
 ["copyright","Copyright & Takedown Policy","DRAFT FOR LEGAL REVIEW — Explain the notice-and-review process, required evidence of ownership or authority, URLs and identification of the disputed material, counter-notice route where appropriate, repeat-infringer policy and contact details. Do not promise automatic removal without review. Respect applicable UK and EU intermediary rules."],
 ["seller-terms","Creator Seller Terms","DRAFT FOR LEGAL REVIEW — Define seller eligibility, ownership and licences, permitted GTA VI fan content, prohibited assets, listing review, pricing and fees, payment settlement after Stripe Connect is activated, taxes, consumer rights, refunds, chargebacks, takedowns, warranties and seller indemnities. Payments are not currently enabled."],
 ["refunds","Refund Policy","DRAFT FOR LEGAL REVIEW — Set out separate rules for digital content and physical goods, statutory consumer rights, cancellation rights and exceptions, defective goods, delivery, refund timing and complaint escalation. Align with UK Consumer Rights Act 2015, Consumer Contracts Regulations 2013 and relevant EU consumer law before publication."],
 ["about","About VICEHUB","VICEHUB is an independent creator community and content platform focused on Grand Theft Auto VI fan creativity. It is not affiliated with, endorsed by or sponsored by Rockstar Games or Take-Two Interactive. All third-party trademarks remain the property of their respective owners."],
 ["contact","Contact","For platform support, moderation, copyright notices and privacy requests, use the contact address configured by the platform operator. Add and verify a monitored support email before publishing this page."]
 ];
 let pageCount=0;
 for(const [slug,title,content] of templates){const exists=await db.SitePage.filter({slug,locale:"en"},"created_date",1,0);if(!exists.length){await db.SitePage.create({slug,title,content,locale:"en",status:["about","contact"].includes(slug)?"published":"draft",meta_title:title+" — VICEHUB",meta_description:"VICEHUB platform information",updated_by:context.user.id});pageCount++;}}
 const defaultSources=[
  ["Rockstar Games — Official YouTube","https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A","official"],
  ["Rockstar Intel","https://rockstarintel.com/feed","media"],
  ["GTABase News","https://www.gtabase.com/news/?format=feed&type=rss","community"],
  ["GTA BOOM","https://www.gtaboom.com/feed","community"],
  ["IGN Gaming News","https://www.ign.com/rss/v2/articles/feed","media"],
  ["GameSpot News","https://www.gamespot.com/feeds/news/","media"]
 ];
 let sourcesCreated=0;
 for(const [name,feed_url,source_type] of defaultSources){const exists=await db.NewsSource.filter({feed_url},"created_date",1,0);if(!exists.length){await db.NewsSource.create({name,feed_url,source_type,enabled:true,created_by:context.user.id});sourcesCreated++;}}
 const defaultAgents=[
  ["news_editor","News Editor","Review GTA VI source material. Separate official statements, independently confirmed facts, reported claims, rumours, theories and opinions. Never invent facts, never remove uncertainty, cite source URLs, create concise editorial drafts only, and never publish automatically."],
  ["seo_agent","SEO Agent","Create accurate search titles, meta descriptions, headings, internal-link suggestions and keyword clusters for VICEHUB. Avoid keyword stuffing, trademark misuse and unsupported claims. Return practical recommendations."],
  ["geo_agent","GEO / Answer Engine Agent","Prepare concise, source-grounded answers and structured FAQ content about GTA VI creator topics. Clearly label uncertainty, link primary sources and never claim affiliation with Rockstar Games."],
  ["social_agent","Social Media Agent","Prepare platform-native TikTok, Instagram, YouTube and X copy from supplied verified facts. Tailor hooks and captions to the channel, include a clear CTA, and do not invent gameplay details or present rumours as facts."],
  ["platform_analyst","Platform Analyst","Analyse only the metrics and operational data supplied in the task. Identify trends, anomalies, risks and actionable next steps. Never fabricate missing analytics or imply access to external accounts." ]
 ];
 let agentsCreated=0;
 for(const [agent_key,display_name,instructions] of defaultAgents){const exists=await db.AIAgentConfig.filter({agent_key},"created_date",1,0);if(!exists.length){await db.AIAgentConfig.create({agent_key,display_name,instructions,provider_model:"",enabled:false,schedule:"manual",monthly_run_limit:50});agentsCreated++;}}
 return {categoriesCreated:categoryCount,pagesCreated:pageCount,sourcesCreated,agentsCreated,legalPagesRequireReview:true};
});

export const runConfiguredAgent = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({agentId:z.string().min(1),taskInput:z.string().min(5).max(3000)}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
  const agent=await db.AIAgentConfig.get(data.agentId).catch(()=>null);
  if(!agent||!agent.enabled)throw Object.assign(new Error("This agent is not enabled."),{status:403});
  const generated=await omniRouteChat({model:agent.provider_model||undefined,messages:[{role:"system",content:agent.instructions},{role:"user",content:data.taskInput}],temperature:0.4,maxTokens:1800,title:"VICEHUB Agent"});
   const output=generated.output,model=generated.model;
   const saved=await db.AIContentDraft.create({user_id:context.user.id,platform:"General",content_type:agent.agent_key==="seo_agent"?"SEO":agent.agent_key==="geo_agent"?"GEO":agent.agent_key==="social_agent"?"Caption":"Description",topic:data.taskInput,output,status:"draft",provider:model});
  await db.AIAgentConfig.update(agent.id,{last_run_at:new Date().toISOString(),last_run_status:"Completed successfully"});
  return {output,draftId:saved.id,model};
 });

export const createContentReport = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({targetType:z.enum(["news","thread","post","listing","product"]),targetId:z.string().min(1),reason:z.enum(["copyright","spam","abuse","misinformation","other"]),details:z.string().max(2000).optional()}))
 .handler(async({data,context})=>context.getBase44().asServiceRole.entities.ContentReport.create({reporter_id:context.user.id,target_type:data.targetType,target_id:data.targetId,reason:data.reason,details:data.details||"",status:"open"}));

export const getPublicPlans = createServerFn({method:"GET"}).validator(z.object({currency:z.enum(["USD","EUR","GBP"]).default("USD")})).handler(async({data,context})=>{
 const db=context.getBase44().asServiceRole.entities;
 const rows=await db.SubscriptionPlan.filter({tier_code:"pro",status:"active",currency:data.currency,monthly_price_cents:{$gt:0},monthly_download_limit:{$gt:0}},"sort_order",1,0);
 const assets=await db.Video.filter({status:"published",license_status:"verified"},"-published_at",5,0,["id"]);
 return rows.map(plan=>({...plan,catalogueReady:assets.length>=5,publishedAssetCount:assets.length}));
});
export const getAdminPlans = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.SubscriptionPlan.list("sort_order",100,0);});
export const saveAdminPlan = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),tierCode:z.enum(["starter","pro","premium"]),displayName:z.string().min(2).max(50),monthlyPriceCents:z.number().int().min(0),currency:z.enum(["USD","EUR","GBP"]),monthlyDownloadLimit:z.number().int().min(0),cleanDownloads:z.boolean(),marketplaceEnabled:z.boolean(),status:z.enum(["draft","active","archived"]),loyaltyMonthlyDiscountPercent:z.number().min(0).max(100),loyaltyMaxDiscountPercent:z.number().min(0).max(100),loyaltyFloorPriceCents:z.number().int().min(0),sortOrder:z.number().int()}))
 .handler(async({data,context})=>{
  requireAdmin(context);
  const db=context.getBase44().asServiceRole.entities.SubscriptionPlan;
  const existing=data.id?await db.get(data.id):null;
  const ladder=Array.isArray(existing?.price_ladder_cents)&&existing.price_ladder_cents.length?existing.price_ladder_cents:null;
  if(ladder&&existing.currency!==data.currency)throw Object.assign(new Error("This plan already has a loyalty ladder. Create a separate plan for another currency instead of changing its currency."),{status:409,code:"CURRENCY_CHANGE_WITH_LADDER"});
  const monthlyPriceCents=ladder?Number(ladder[0]):data.monthlyPriceCents;
  const p={tier_code:data.tierCode,display_name:data.displayName,monthly_price_cents:monthlyPriceCents,currency:data.currency,monthly_download_limit:data.monthlyDownloadLimit,clean_downloads:data.cleanDownloads,marketplace_enabled:data.marketplaceEnabled,status:data.status,loyalty_monthly_discount_percent:data.loyaltyMonthlyDiscountPercent,loyalty_max_discount_percent:data.loyaltyMaxDiscountPercent,loyalty_floor_price_cents:data.loyaltyFloorPriceCents,sort_order:data.sortOrder};
  if(existing){
   if(Number(existing.monthly_price_cents)!==monthlyPriceCents||existing.currency!==data.currency)p.stripe_price_id=null;
   return db.update(data.id,p);
  }
  return db.create(p);
 });
export const syncAdminPlanToStripe = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({id:z.string().min(1)})).handler(async({data,context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities.SubscriptionPlan;const plan=await db.get(data.id);if(!plan)throw Object.assign(new Error("Subscription plan not found."),{status:404});if(plan.stripe_price_id)return {plan,productId:plan.stripe_product_id,priceId:plan.stripe_price_id,alreadySynced:true};if(Number(plan.monthly_price_cents||0)<=0||Number(plan.monthly_download_limit||0)<1)throw Object.assign(new Error("Set a positive monthly price and download quota before syncing this plan."),{status:400});let productId=plan.stripe_product_id;if(!productId){const form=new URLSearchParams();form.set("name","VICEHUB "+plan.display_name+" membership");form.set("metadata[tier_code]",plan.tier_code);form.set("metadata[currency]",plan.currency);const product=await stripeApi("products","POST",form);productId=product.id;}const priceForm=new URLSearchParams();priceForm.set("currency",String(plan.currency).toLowerCase());priceForm.set("product",productId);priceForm.set("unit_amount",String(plan.monthly_price_cents));priceForm.set("recurring[interval]","month");priceForm.set("metadata[tier_code]",plan.tier_code);priceForm.set("metadata[download_limit]",String(plan.monthly_download_limit));const price=await stripeApi("prices","POST",priceForm);const updated=await db.update(plan.id,{stripe_product_id:productId,stripe_price_id:price.id});return {plan:updated,productId,priceId:price.id};
});
export const getMyPlanQuote = createServerFn({method:"GET"}).middleware([requireUser])
 .validator(z.object({tierCode:z.enum(["starter","pro","premium"]),currency:z.enum(["USD","EUR","GBP"])}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const plans=await db.SubscriptionPlan.filter({tier_code:data.tierCode,currency:data.currency,status:"active"},"-created_date",1,0);const plan=plans[0];
  if(!plan)throw Object.assign(new Error("This plan is not configured in the selected currency."),{status:404});
  const subs=await db.UserSubscription.filter({user_id:context.user.id},"-created_date",1,0);const sub=subs[0];
  const active=(sub?.status==="active"||sub?.status==="past_due"&&sub?.grace_period_ends_at&&new Date(sub.grace_period_ends_at)>new Date())&&!sub?.voluntary_cancelled;
  const samePlan=sub?.tier_code===data.tierCode&&sub?.currency===data.currency;
  const streak=active&&samePlan?Number(sub?.streak_months||0):0;
  const price=priceForMonth(plan,streak+1);
  return {tierCode:data.tierCode,currency:data.currency,basePriceCents:plan.monthly_price_cents,currentPriceCents:price,streakMonths:streak,nextChargeMonth:streak+1,discountPercent:0,resetOnVoluntaryCancellation:true};
 });


const STRIPE_SITE_URL = "https://gta6-creator-hub-c26cc578.base44.app";
async function stripeApi(path, method = "GET", body = null, idempotencyKey = "") {
  const key = secrets.get("STRIPE_SECRET_KEY");
  if (!key) throw Object.assign(new Error("Stripe billing is not configured yet. Add STRIPE_SECRET_KEY in the secure app secrets before opening paid memberships."), { status: 503, code: "STRIPE_NOT_CONFIGURED" });
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: { Authorization: "Bearer " + key, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    ...(body ? { body: body.toString() } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "Stripe API request failed."), { status: response.status, code: payload?.error?.code || "STRIPE_API_ERROR" });
  return payload;
}
function stripeLocalStatus(status) {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "cancelled";
  return "inactive";
}

export const createStripeCheckoutSession = createServerFn({method:"POST"}).middleware([requireUser])
  .validator(z.object({tierCode:z.literal("pro"),currency:z.enum(["USD","EUR","GBP"]),referralCode:z.string().regex(/^[A-Z0-9]{6,12}$/).optional()}))
  .handler(async({data,context})=>{
    const db=context.getBase44().asServiceRole.entities;
    const user=context.user;
    const plans=await db.SubscriptionPlan.filter({tier_code:"pro",currency:data.currency,status:"active"},"-created_date",1,0);
    const plan=plans[0];
    if(!plan||Number(plan.monthly_price_cents||0)<=0||Number(plan.monthly_download_limit||0)<1)throw Object.assign(new Error("This membership is not yet open for sale. The administrator must configure a positive monthly price and download allowance first."),{status:409,code:"PLAN_NOT_CONFIGURED"});
    const rightsClearedAssets=await db.Video.filter({status:"published",license_status:"verified"},"-published_at",5,0,["id"]);
    if(rightsClearedAssets.length<5)throw Object.assign(new Error("Paid checkout is temporarily closed until at least five rights-cleared downloads are published in the library."),{status:409,code:"CONTENT_LIBRARY_NOT_READY"});
    if(secrets.get("STRIPE_TAX_ENABLED")!=="true")throw Object.assign(new Error("Paid checkout is disabled until Stripe Tax and the applicable tax registrations are configured."),{status:503,code:"STRIPE_TAX_NOT_CONFIGURED"});
    const existingRows=await db.UserSubscription.filter({user_id:user.id},"-created_date",1,0);
    const existing=existingRows[0];
    if(existing?.status==="active"||existing?.status==="trialing"||existing?.status==="past_due")throw Object.assign(new Error("You already have a current or overdue membership. Use Manage membership to update payment details or cancel it; do not create a second subscription."),{status:409,code:"SUBSCRIPTION_ALREADY_ACTIVE"});
    // Single paid membership: no new subscriptions use the legacy degressive ladder.
    const priceCents=Number(plan.monthly_price_cents || 0);
    let referrerUserId = "";
    let referralCouponId = "";
    if (data.referralCode && !existing) {
      const profiles = await db.ReferralProfile.filter({ referral_code: data.referralCode, status: "active" }, "-created_date", 1, 0);
      const profile = profiles[0];
      const priorReferral = await db.ReferralCredit.filter({ referred_user_id: user.id }, "-created_date", 1, 0);
      const referrerUser = profile ? await db.User.get(profile.user_id).catch(() => null) : null;
      const sameEmail = !!(referrerUser?.email && user.email && String(referrerUser.email).toLowerCase() === String(user.email).toLowerCase());
      if (profile && profile.user_id !== user.id && !sameEmail && !priorReferral.length) {
        referrerUserId = profile.user_id;
        referralCouponId = "VICEHUB_REFERRAL_5_FIRST_INVOICE";
        try { await stripeApi("coupons/" + referralCouponId); }
        catch {
          const coupon = new URLSearchParams();
          coupon.set("id", referralCouponId); coupon.set("name", "VICEHUB referral — 5% first invoice");
          coupon.set("percent_off", "5"); coupon.set("duration", "once");
          try { await stripeApi("coupons", "POST", coupon); }
          catch { await stripeApi("coupons/" + referralCouponId); }
        }
      } else if (!profile) {
        throw Object.assign(new Error("This referral link is not valid."), { status: 400, code: "INVALID_REFERRAL_CODE" });
      }
    }
    const discount=referrerUserId ? 5 : 0;
    if(priceCents<=0)throw Object.assign(new Error("The calculated membership price is invalid. Check the administrator pricing settings."),{status:409,code:"INVALID_PLAN_PRICE"});
    let stripeProductId=plan.stripe_product_id;
    if(!stripeProductId){
      const productForm=new URLSearchParams();
      productForm.set("name","VICEHUB "+plan.display_name+" membership");
      productForm.set("metadata[tier_code]",data.tierCode);
      productForm.set("metadata[currency]",data.currency);
      const product=await stripeApi("products","POST",productForm);
      stripeProductId=product.id;
      await db.SubscriptionPlan.update(plan.id,{stripe_product_id:stripeProductId});
    }
    let stripePriceId=plan.stripe_price_id;
    if(!stripePriceId){
      const priceForm=new URLSearchParams();
      priceForm.set("currency",data.currency.toLowerCase());
      priceForm.set("product",stripeProductId);
      priceForm.set("unit_amount",String(priceCents));
      priceForm.set("recurring[interval]","month");
      const price=await stripeApi("prices","POST",priceForm);
      stripePriceId=price.id;
      await db.SubscriptionPlan.update(plan.id,{stripe_price_id:stripePriceId});
    }
    const form=new URLSearchParams();
    form.set("mode","subscription");
    form.set("success_url",STRIPE_SITE_URL+"/subscription/success?session_id={CHECKOUT_SESSION_ID}");
    form.set("cancel_url",STRIPE_SITE_URL+"/#plans?checkout=cancelled");
    form.set("client_reference_id",user.id);
    form.set("metadata[user_id]",user.id);
    form.set("metadata[tier_code]",data.tierCode);
    form.set("metadata[currency]",data.currency);
    form.set("metadata[monthly_price_cents]",String(priceCents));
    form.set("metadata[discount_percent]",String(discount));
    if (referrerUserId) { form.set("metadata[referrer_user_id]", referrerUserId); form.set("metadata[referral_code]", data.referralCode); form.set("subscription_data[metadata][referrer_user_id]", referrerUserId); form.set("subscription_data[metadata][referral_code]", data.referralCode); form.set("discounts[0][coupon]", referralCouponId); }
    form.set("subscription_data[metadata][user_id]",user.id);
    form.set("subscription_data[metadata][tier_code]",data.tierCode);
    form.set("subscription_data[metadata][currency]",data.currency);
    form.set("subscription_data[metadata][monthly_price_cents]",String(priceCents));
    form.set("subscription_data[metadata][discount_percent]",String(discount));
    form.set("line_items[0][price]",stripePriceId);
    form.set("line_items[0][quantity]","1");
    form.set("billing_address_collection","required");
    form.set("automatic_tax[enabled]","true");
    if(existing?.stripe_customer_id)form.set("customer",existing.stripe_customer_id);
    else if(user.email)form.set("customer_email",user.email);
    const session=await stripeApi("checkout/sessions","POST",form);
    if(!session.url)throw new Error("Stripe did not return a checkout URL.");
    return {url:session.url,sessionId:session.id,priceCents,currency:data.currency,discountPercent:discount};
  });

export const confirmStripeCheckoutSession = createServerFn({method:"POST"}).middleware([requireUser])
  .validator(z.object({sessionId:z.string().min(10).max(255)}))
  .handler(async({data,context})=>{
    const session=await stripeApi("checkout/sessions/"+encodeURIComponent(data.sessionId)+"?expand%5B%5D=subscription");
    const user=context.user;
    if(session.client_reference_id!==user.id||session.metadata?.user_id!==user.id)throw Object.assign(new Error("This checkout session does not belong to your account."),{status:403,code:"CHECKOUT_OWNER_MISMATCH"});
    if(session.mode!=="subscription"||session.status!=="complete"||session.payment_status!=="paid")throw Object.assign(new Error("Stripe has not confirmed a completed membership payment."),{status:409,code:"CHECKOUT_NOT_PAID"});
    let stripeSubscription=session.subscription;
    if(typeof stripeSubscription==="string")stripeSubscription=await stripeApi("subscriptions/"+encodeURIComponent(stripeSubscription));
    if(!stripeSubscription?.id)throw new Error("Stripe did not return the subscription record.");
    const status=stripeLocalStatus(stripeSubscription.status);
    if(status!=="active"&&status!=="trialing")throw Object.assign(new Error("The Stripe subscription is not active yet."),{status:409,code:"SUBSCRIPTION_NOT_ACTIVE"});
    const tierCode=session.metadata?.tier_code;
    if(!["starter","pro","premium"].includes(tierCode))throw new Error("The checkout metadata does not contain a valid membership tier.");
    const currency=(session.currency||session.metadata?.currency||"usd").toUpperCase();
    const priceCents=Number(session.metadata?.monthly_price_cents||stripeSubscription.items?.data?.[0]?.price?.unit_amount||0);
    const customerId=typeof session.customer==="string"?session.customer:session.customer?.id;
    const startedAt=stripeSubscription.current_period_start?new Date(stripeSubscription.current_period_start*1000).toISOString():new Date().toISOString();
    const db=context.getBase44().asServiceRole.entities;
    const rows=await db.UserSubscription.filter({user_id:user.id},"-created_date",1,0);
    const payload={user_id:user.id,tier_code:tierCode,status,currency,started_at:startedAt,streak_months:0,loyalty_discount_percent:Number(session.metadata?.discount_percent||0),current_monthly_price_cents:priceCents,stripe_customer_id:customerId,stripe_subscription_id:stripeSubscription.id,voluntary_cancelled:false};
    if(rows[0])await db.UserSubscription.update(rows[0].id,payload);else await db.UserSubscription.create(payload);
    let referralCreditCreated = false;
    const referrerUserId = String(session.metadata?.referrer_user_id || "");
    if (referrerUserId && referrerUserId !== user.id) {
      const existingCredit = await db.ReferralCredit.filter({ referred_user_id: user.id }, "-created_date", 1, 0);
      if (!existingCredit.length) {
        const paidCents = Math.max(0, Number(session.amount_total || 0) - Number(session.total_details?.amount_tax || 0));
        const commissionCents = Math.floor(paidCents * 0.20);
        if (commissionCents > 0) {
          await db.ReferralCredit.create({
            referrer_user_id: referrerUserId, referred_user_id: user.id,
            stripe_session_id: session.id, stripe_subscription_id: stripeSubscription.id,
            currency, amount_cents: commissionCents, available_cents: commissionCents,
            redeemed_cents: 0, commission_rate_percent: 20, referral_discount_percent: 5,
            status: "pending", available_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
          referralCreditCreated = true;
        }
      }
    }
    return {success:true,tierCode,status,currency,priceCents,startedAt,referralCreditCreated};
  });

export const getMyReferralDashboard = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
  const db=context.getBase44().asServiceRole.entities, user=context.user;
  let profiles=await db.ReferralProfile.filter({user_id:user.id},"-created_date",1,0);
  let profile=profiles[0];
  if(!profile){
    let code="";
    for(let attempt=0;attempt<5;attempt++){
      code=crypto.randomUUID().replace(/-/g,"").slice(0,10).toUpperCase();
      const collision=await db.ReferralProfile.filter({referral_code:code},"-created_date",1,0);
      if(!collision.length)break;
      code="";
    }
    if(!code)throw new Error("Could not create a unique referral code. Retry shortly.");
    profile=await db.ReferralProfile.create({user_id:user.id,referral_code:code,status:"active"});
  }
  const credits=await db.ReferralCredit.filter({referrer_user_id:user.id},"-created_date",1000,0);
  const subs=await db.UserSubscription.filter({user_id:user.id},"-created_date",1,0), sub=subs[0];
  const currency=sub?.currency||"GBP", now=Date.now(), balances={GBP:{earnedCents:0,availableCents:0},EUR:{earnedCents:0,availableCents:0},USD:{earnedCents:0,availableCents:0}};
  let referralCount=0;
  for(const credit of credits){
    if(credit.status==="reversed")continue;
    referralCount++;
    const code=String(credit.currency||"GBP").toUpperCase();
    if(!balances[code])continue;
    balances[code].earnedCents+=Number(credit.amount_cents||0);
    if(credit.status==="pending"&&credit.available_at&&new Date(credit.available_at).getTime()<=now){
      await db.ReferralCredit.update(credit.id,{status:"available"});
      credit.status="available";
    }
    if(["available","pending"].includes(credit.status)&&(!credit.available_at||new Date(credit.available_at).getTime()<=now))balances[code].availableCents+=Number(credit.available_cents??credit.amount_cents??0);
  }
  const isSubscribed=!!sub&&sub.status==="active"&&!sub.voluntary_cancelled&&!!sub.stripe_customer_id;
  return {code:profile.referral_code,referralCount,earnedCents:balances[currency]?.earnedCents||0,availableCents:balances[currency]?.availableCents||0,currency,isSubscribed,balances};
});

export const applyReferralWalletCredit = createServerFn({method:"POST"}).middleware([requireUser]).handler(async({context})=>{
  const db=context.getBase44().asServiceRole.entities,user=context.user;
  const subs=await db.UserSubscription.filter({user_id:user.id},"-created_date",1,0),sub=subs[0];
  if(!sub||sub.status!=="active"||sub.voluntary_cancelled||!sub.stripe_customer_id)throw Object.assign(new Error("An active paid membership is required before applying referral credit."),{status:403,code:"ACTIVE_MEMBERSHIP_REQUIRED"});
  const currency=String(sub.currency||"GBP").toUpperCase();
  const pendingRows=await db.ReferralRedemption.filter({user_id:user.id,status:"pending"},"-created_date",1,0);
  let redemption=pendingRows[0];
  if(redemption&&(redemption.currency!==currency||redemption.stripe_customer_id!==sub.stripe_customer_id))throw Object.assign(new Error("A previous wallet-credit application must be reconciled before changing billing currency or customer."),{status:409,code:"REFERRAL_REDEMPTION_PENDING"});
  if(!redemption){
    const credits=await db.ReferralCredit.filter({referrer_user_id:user.id,currency,status:{$in:["available","pending"]}},"created_date",1000,0);
    const now=Date.now(),allocations=[];let available=0;
    for(const credit of credits){
      if(credit.status==="pending"&&credit.available_at&&new Date(credit.available_at).getTime()>now)continue;
      const cents=Number(credit.available_cents??credit.amount_cents??0);
      if(cents>0){available+=cents;allocations.push({credit_id:credit.id,amount_cents:cents,remaining_after_cents:0,redeemed_after_cents:Number(credit.redeemed_cents||0)+cents});}
    }
    const planRows=await db.SubscriptionPlan.filter({tier_code:sub.tier_code,currency,status:"active"},"-created_date",1,0);
    const maxCredit=Math.max(0,Number(sub.current_monthly_price_cents||planRows[0]?.monthly_price_cents||0));
    const redeemCents=Math.min(available,maxCredit);
    if(redeemCents<1)throw Object.assign(new Error("No validated referral credit is available for this invoice yet."),{status:409,code:"NO_REFERRAL_CREDIT"});
    let remaining=redeemCents;
    for(const allocation of allocations){const used=Math.min(allocation.amount_cents,remaining);allocation.amount_cents=used;const creditRow=await db.ReferralCredit.get(allocation.credit_id);allocation.remaining_after_cents=Number(creditRow.available_cents??creditRow.amount_cents??0)-used;allocation.redeemed_after_cents=Number(creditRow.redeemed_cents||0)+used;remaining-=used;if(remaining<=0)break;}
    redemption=await db.ReferralRedemption.create({user_id:user.id,amount_cents:redeemCents,currency,stripe_customer_id:sub.stripe_customer_id,idempotency_key:crypto.randomUUID(),allocations:allocations.filter(x=>x.amount_cents>0),status:"pending"});
  }
  const redemptionCurrency=String(redemption.currency||currency).toUpperCase();
  const form=new URLSearchParams();form.set("amount",String(-Number(redemption.amount_cents)));form.set("currency",redemptionCurrency.toLowerCase());form.set("description","VICEHUB referral membership credit");form.set("metadata[user_id]",user.id);form.set("metadata[referral_redemption_id]",redemption.id);
  try{
    const transaction=await stripeApi("customers/"+encodeURIComponent(redemption.stripe_customer_id)+"/balance_transactions","POST",form,redemption.idempotency_key);
    for(const allocation of redemption.allocations||[]){
      const credit=await db.ReferralCredit.get(allocation.credit_id);
      const remaining=Number(allocation.remaining_after_cents||0);
      const redeemedAfter=Number(allocation.redeemed_after_cents ?? (Number(credit.redeemed_cents||0)+Number(allocation.amount_cents||0)));
      await db.ReferralCredit.update(credit.id,{available_cents:remaining,redeemed_cents:redeemedAfter,status:remaining>0?"available":"redeemed"});
    }
    await db.ReferralRedemption.update(redemption.id,{status:"applied",stripe_balance_transaction_id:transaction.id,applied_at:new Date().toISOString()});
    return {success:true,amountCents:Number(redemption.amount_cents),currency,message:"Credit has been added to your Stripe customer balance and will reduce your next invoice. Any unused wallet balance remains available."};
  }catch(error){
    await db.ReferralRedemption.update(redemption.id,{last_error:String(error?.message||error).slice(0,500)}).catch(()=>null);
    throw error;
  }
});

export const createStripePortalSession = createServerFn({method:"POST"}).middleware([requireUser])
  .handler(async({context})=>{
    const rows=await context.getBase44().asServiceRole.entities.UserSubscription.filter({user_id:context.user.id},"-created_date",1,0);
    const customerId=rows[0]?.stripe_customer_id;
    if(!customerId)throw Object.assign(new Error("No Stripe billing customer is linked to this account yet."),{status:404,code:"STRIPE_CUSTOMER_NOT_FOUND"});
    const form=new URLSearchParams();form.set("customer",customerId);form.set("return_url",STRIPE_SITE_URL+"/dashboard");
    const portal=await stripeApi("billing_portal/sessions","POST",form);
    return {url:portal.url};
  });

export const refreshMySubscription = createServerFn({method:"POST"}).middleware([requireUser])
  .handler(async({context})=>{
    const db=context.getBase44().asServiceRole.entities;
    const rows=await db.UserSubscription.filter({user_id:context.user.id},"-created_date",1,0);
    const local=rows[0];
    if(!local?.stripe_subscription_id||!secrets.get("STRIPE_SECRET_KEY"))return {status:local?.status||"inactive",synced:false};
    const stripeSub=await stripeApi("subscriptions/"+encodeURIComponent(local.stripe_subscription_id));
    const status=stripeLocalStatus(stripeSub.status);
    const cancelled=!!stripeSub.cancel_at_period_end||stripeSub.status==="canceled";
    await db.UserSubscription.update(local.id,{
      status,
      voluntary_cancelled:cancelled,
      ...(stripeSub.current_period_start?{started_at:new Date(stripeSub.current_period_start*1000).toISOString()}:{}),
      ...(stripeSub.items?.data?.[0]?.price?.unit_amount?{current_monthly_price_cents:stripeSub.items.data[0].price.unit_amount}:{}),
      ...(stripeSub.cancel_at?{cancelled_at:new Date(stripeSub.cancel_at*1000).toISOString()}:{}),
    });
    return {status,synced:true};
  });

export const getAdminMarketplaceListings = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.MarketplaceListing.list("-created_date",200,0);});
export const setMarketplaceListingStatus = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({listingId:z.string().min(1),status:z.enum(["published","rejected","archived"])}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
  const listing=await db.MarketplaceListing.get(data.listingId);
  if(data.status==="published"){
   const subs=await db.UserSubscription.filter({user_id:listing.seller_id},"-created_date",1,0);
   if(subs[0]?.tier_code!=="premium"||subs[0]?.status!=="active"||subs[0]?.voluntary_cancelled)throw Object.assign(new Error("Only active Premium creators can have published marketplace listings."),{status:403,code:"PREMIUM_REQUIRED"});
  }
  return db.MarketplaceListing.update(listing.id,{status:data.status});
 });

export const replyMarketplaceInquiry = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({inquiryId:z.string().min(1),reply:z.string().min(2).max(2000)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities;
  const inquiry=await db.MarketplaceInquiry.get(data.inquiryId).catch(()=>null);
  if(!inquiry||inquiry.seller_id!==context.user.id)throw Object.assign(new Error("Only the listing creator can reply to this enquiry."),{status:403});
  const updated=await db.MarketplaceInquiry.update(inquiry.id,{seller_reply:data.reply,status:"replied",replied_at:new Date().toISOString()});
  await db.UserNotification.create({user_id:inquiry.buyer_id,type:"marketplace",title:"Creator replied to your enquiry",body:"The seller replied to your marketplace enquiry.",target_url:"/marketplace"});
  return updated;
 });

export const getCreatorDirectory = createServerFn({method:"GET"}).validator(z.object({query:z.string().max(100).optional()})).handler(async({data,context})=>{
 const rows=await context.getBase44().asServiceRole.entities.CreatorProfile.filter({status:"published"},"-created_date",100,0);
 const q=(data.query||"").toLowerCase();return rows.filter(x=>!q||x.display_name.toLowerCase().includes(q)||(x.bio||"").toLowerCase().includes(q));
});
export const getMyCreatorProfile = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 const rows=await context.getBase44().asServiceRole.entities.CreatorProfile.filter({user_id:context.user.id},"-created_date",1,0);return rows[0]||null;
});
export const saveMyCreatorProfile = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),displayName:z.string().min(2).max(80),bio:z.string().max(2000),avatarUrl:z.string().url().or(z.literal("")).optional(),bannerUrl:z.string().url().or(z.literal("")).optional(),websiteUrl:z.string().url().or(z.literal("")).optional(),locationLabel:z.string().max(100).optional(),skills:z.array(z.string().max(40)).max(20)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities.CreatorProfile;
  const payload={user_id:context.user.id,display_name:data.displayName,bio:data.bio,status:"pending_review",skills:data.skills,...(data.avatarUrl?{avatar_url:data.avatarUrl}:{}),...(data.bannerUrl?{banner_url:data.bannerUrl}:{}),...(data.websiteUrl?{website_url:data.websiteUrl}:{}),...(data.locationLabel?{location_label:data.locationLabel}:{})};
  if(context.user.role==="admin")payload.status="published";
  if(data.id){const existing=await db.get(data.id).catch(()=>null);if(!existing||existing.user_id!==context.user.id)throw Object.assign(new Error("You can only edit your own creator profile."),{status:403});return db.update(existing.id,payload);}
  const current=await db.filter({user_id:context.user.id},"-created_date",1,0);if(current.length)return db.update(current[0].id,payload);
  return db.create(payload);
 });
export const getAdminCreatorProfiles = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.CreatorProfile.list("-created_date",200,0);});
export const setCreatorProfileStatus = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({profileId:z.string(),status:z.enum(["published","hidden"])}))
 .handler(async({data,context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.CreatorProfile.update(data.profileId,{status:data.status});});

export const getMyMessages = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 const db=context.getBase44().asServiceRole.entities;const [inbox,sent]=await Promise.all([db.DirectMessage.filter({recipient_id:context.user.id,status:{$ne:"hidden"}},"-created_date",100,0),db.DirectMessage.filter({sender_id:context.user.id,status:{$ne:"hidden"}},"-created_date",100,0)]);
 return {inbox,sent};
});
export const sendDirectMessage = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({recipientId:z.string().min(1),body:z.string().min(1).max(5000)}))
 .handler(async({data,context})=>{
  if(data.recipientId===context.user.id)throw Object.assign(new Error("You cannot message yourself."),{status:400});
  const db=context.getBase44().asServiceRole.entities;
  const recipientProfile=await db.CreatorProfile.filter({user_id:data.recipientId,status:"published"},"-created_date",1,0);
  if(!recipientProfile.length)throw Object.assign(new Error("You can only message creators with a published VICEHUB profile."),{status:404});
  const [blockedBySender,blockedByRecipient]=await Promise.all([db.UserBlock.filter({blocker_id:context.user.id,blocked_id:data.recipientId},"-created_date",1,0),db.UserBlock.filter({blocker_id:data.recipientId,blocked_id:context.user.id},"-created_date",1,0)]);
  if(blockedBySender.length||blockedByRecipient.length)throw Object.assign(new Error("This message cannot be sent because one user has blocked the other."),{status:403,code:"MESSAGING_BLOCKED"});
  const message=await db.DirectMessage.create({sender_id:context.user.id,recipient_id:data.recipientId,body:data.body,status:"sent"});
  await db.UserNotification.create({user_id:data.recipientId,type:"message",title:"New creator message",body:"You have received a new private message.",target_url:"/messages"});
  return message;
 });
export const markMessageRead = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({messageId:z.string()}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities,message=await db.DirectMessage.get(data.messageId);
  if(message.recipient_id!==context.user.id)throw Object.assign(new Error("You cannot update another user's message."),{status:403});
  return db.DirectMessage.update(message.id,{status:"seen",read_at:new Date().toISOString()});
 });
export const blockCreator = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({userId:z.string().min(1),reason:z.string().max(300).optional()}))
 .handler(async({data,context})=>{
  if(data.userId===context.user.id)throw new Error("You cannot block yourself.");
  const db=context.getBase44().asServiceRole.entities,existing=await db.UserBlock.filter({blocker_id:context.user.id,blocked_id:data.userId},"-created_date",1,0);
  if(existing.length)return existing[0];return db.UserBlock.create({blocker_id:context.user.id,blocked_id:data.userId,reason:data.reason||""});
 });
export const unblockCreator = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({userId:z.string().min(1)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities,rows=await db.UserBlock.filter({blocker_id:context.user.id,blocked_id:data.userId},"-created_date",10,0);
  for(const row of rows)await db.UserBlock.delete(row.id);return {success:true};
 });
export const getMyNotifications = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>context.getBase44().asServiceRole.entities.UserNotification.filter({user_id:context.user.id},"-created_date",100,0));
export const markNotificationRead = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({notificationId:z.string()}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities,n=await db.UserNotification.get(data.notificationId);
  if(n.user_id!==context.user.id)throw Object.assign(new Error("Not your notification."),{status:403});
  return db.UserNotification.update(n.id,{read_at:new Date().toISOString()});
 });
export const toggleForumReaction = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({targetType:z.enum(["thread","post"]),targetId:z.string(),reaction:z.enum(["like","insightful","funny"])}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities,existing=await db.ForumReaction.filter({user_id:context.user.id,target_type:data.targetType,target_id:data.targetId,reaction:data.reaction},"-created_date",1,0);
  if(existing.length){await db.ForumReaction.delete(existing[0].id);return {active:false};}
  await db.ForumReaction.create({user_id:context.user.id,target_type:data.targetType,target_id:data.targetId,reaction:data.reaction});return {active:true};
 });

export const grantComplimentaryPremium = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({userId:z.string().min(1),currency:z.enum(["USD","EUR","GBP"]).default("USD")}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
  const rows=await db.UserSubscription.filter({user_id:data.userId},"-created_date",1,0);
  const payload={user_id:data.userId,tier_code:"premium",status:"active",currency:data.currency,started_at:new Date().toISOString(),streak_months:0,loyalty_discount_percent:0,current_monthly_price_cents:0,voluntary_cancelled:false};
  return rows[0]?db.UserSubscription.update(rows[0].id,payload):db.UserSubscription.create(payload);
 });

async function translateWithConfiguredAI(sourceText,targetLanguage,contextLabel){
 const generated=await omniRouteChat({messages:[{role:"system",content:"Translate the provided "+contextLabel+" faithfully into "+targetLanguage+". Preserve meaning, factual distinctions, proper names, URLs, HTML/Markdown structure and all GTA VI trademark disclaimers. Return only a valid JSON object with translated fields."},{role:"user",content:sourceText}],temperature:0.2,maxTokens:4000,title:"VICEHUB Translation"});
  const raw=generated.output;
  const cleaned=raw.replace(/^\s*\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60\s*$/,"").trim();
 try{return JSON.parse(cleaned);}catch{throw new Error("AI translation did not return valid structured JSON.");}
}
export const translateCmsPage = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({pageId:z.string().min(1),targetLocale:z.enum(["fr","es","de","it","pt"])}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
  const page=await db.SitePage.get(data.pageId);
  const exists=await db.SitePage.filter({slug:page.slug,locale:data.targetLocale},"-created_date",1,0);
  if(exists.length)throw Object.assign(new Error("A page translation already exists for this language. Edit that version instead."),{status:409});
  const translated=await translateWithConfiguredAI(JSON.stringify({title:page.title,content:page.content,metaTitle:page.meta_title||"",metaDescription:page.meta_description||""}),({fr:"French",es:"Spanish",de:"German",it:"Italian",pt:"Portuguese"})[data.targetLocale],"CMS page");
  if(!translated.title||!translated.content)throw new Error("Translation output is missing required page fields.");
  return db.SitePage.create({slug:page.slug,title:translated.title,content:translated.content,locale:data.targetLocale,status:"draft",meta_title:translated.metaTitle||translated.title,meta_description:translated.metaDescription||"",updated_by:context.user.id});
 });
export const translateNewsArticle = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({articleId:z.string().min(1),targetLocale:z.enum(["fr","es","de","it","pt"])}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
  const article=await db.NewsArticle.get(data.articleId);
  const exists=await db.NewsArticle.filter({slug:article.slug,locale:data.targetLocale},"-created_date",1,0);
  if(exists.length)throw Object.assign(new Error("A translation already exists for this language."),{status:409});
  const translated=await translateWithConfiguredAI(JSON.stringify({title:article.title,summary:article.summary,body:article.body,tags:article.tags||[]}),({fr:"French",es:"Spanish",de:"German",it:"Italian",pt:"Portuguese"})[data.targetLocale],"GTA VI news article");
  if(!translated.title||!translated.summary||!translated.body)throw new Error("Translation output is missing required article fields.");
  return db.NewsArticle.create({title:translated.title,slug:article.slug,summary:translated.summary,body:translated.body,source_name:article.source_name,source_url:article.source_url,source_type:article.source_type,confidence:article.confidence,locale:data.targetLocale,status:"draft",tags:translated.tags||article.tags||[],created_by:context.user.id});
 });


/**
 * Paginated public catalogue endpoint.
 * The client requests small pages instead of loading the entire library.
 */
export const listPublishedVideosPage = createServerFn({ method: "GET" })
  .validator(z.object({
    category: z.enum(["Cinematics", "Gameplay", "Characters", "Vehicles", "Locations", "Missions", "Shorts", "Edit packs", "Tutorials", "Other"]).optional(),
    language: z.enum(["en", "fr", "es", "pt", "it", "de"]).optional(),
    search: z.string().trim().max(100).optional(),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(48).default(24),
  }))
  .handler(async ({ data, context }) => {
    const base44 = context.getBase44();
    const filter = { status: "published", license_status: "verified" };
    if (data.category) filter.category = data.category;
    if (data.language) filter.language = data.language;
    if (data.search) {
      // Escape regular-expression metacharacters so search input remains literal.
      const term = data.search.split("").map((char) => "\\^$.*+?()[]{}|".includes(char) ? "\\" + char : char).join("");
      filter.$or = [
        { title: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
        { creator_name: { $regex: term, $options: "i" } },
        { tags: { $regex: term, $options: "i" } },
      ];
    }
    const rows = await base44.asServiceRole.entities.Video.filter(
      filter,
      "-published_at",
      data.limit + 1,
      data.offset,
      ["id", "title", "description", "category", "language", "is_featured", "tags", "duration_seconds", "thumbnail_url", "creator_name", "published_at"],
    );
    const videos = rows.slice(0, data.limit);
    return {
      videos,
      hasMore: rows.length > data.limit,
      nextOffset: data.offset + videos.length,
      pageSize: data.limit,
    };
  });


// -----------------------------------------------------------------------------
// Per-user social OAuth and publishing. Provider tokens are encrypted at rest.
// AI copy generation is separate and must never receive provider credentials.
// -----------------------------------------------------------------------------
const SOCIAL_CALLBACK_URL = "https://gta6-creator-hub-c26cc578.base44.app/social";
const SOCIAL_PROVIDERS = ["TikTok", "Instagram", "YouTube", "X"];

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64(value) {
  const standard = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function digestText(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function socialEncryptionKey() {
  const secret = secrets.get("SOCIAL_TOKEN_ENCRYPTION_KEY");
  if (!secret || secret.length < 32) throw Object.assign(new Error("Social connections are not enabled yet. Configure SOCIAL_TOKEN_ENCRYPTION_KEY (32+ characters) in Base44 secrets."), { status: 503, code: "SOCIAL_ENCRYPTION_NOT_CONFIGURED" });
  return crypto.subtle.importKey("raw", await digestText(secret), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptSocialToken(value) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await socialEncryptionKey(), encoder.encode(value));
  return toBase64Url(iv) + "." + toBase64Url(encrypted);
}
async function decryptSocialToken(value) {
  if (!value) return "";
  const [ivPart, dataPart] = String(value).split(".");
  if (!ivPart || !dataPart) throw new Error("Stored social credential has an invalid format. Reconnect this account.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivPart) }, await socialEncryptionKey(), fromBase64(dataPart));
  return new TextDecoder().decode(plain);
}
function randomVerifier() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(48)));
}
async function createSocialStateHash(state) {
  const secret = secrets.get("SOCIAL_OAUTH_STATE_SECRET");
  if (!secret || secret.length < 32) throw Object.assign(new Error("Configure SOCIAL_OAUTH_STATE_SECRET (32+ characters) before enabling social OAuth."), { status: 503, code: "SOCIAL_OAUTH_NOT_CONFIGURED" });
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(state)));
}
async function socialTokenRequest(url, body, clientId, clientSecret) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" };
  if (clientId && clientSecret) headers.Authorization = "Basic " + btoa(clientId + ":" + clientSecret);
  const response = await fetch(url, { method: "POST", headers, body: body.toString() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error_description || payload.error?.message || payload.message || "Social provider token exchange failed (HTTP " + response.status + ")."), { status: 502, code: "SOCIAL_TOKEN_EXCHANGE_FAILED" });
  return payload;
}
async function saveSocialAccount(db, userId, record) {
  const encryptedAccess = await encryptSocialToken(record.accessToken);
  const encryptedRefresh = await encryptSocialToken(record.refreshToken || "");
  const payload = {
    user_id: userId, provider: record.provider, provider_account_id: String(record.accountId),
    account_name: String(record.accountName || record.accountId).slice(0, 160),
    account_type: record.accountType || "profile",
    encrypted_access_token: encryptedAccess, encrypted_refresh_token: encryptedRefresh,
    ...(record.expiresAt ? { token_expires_at: record.expiresAt } : {}),
    ...(record.refreshExpiresAt ? { refresh_expires_at: record.refreshExpiresAt } : {}),
    scopes: record.scopes || [], status: "connected",
    metadata_json: JSON.stringify(record.metadata || {}).slice(0, 5000),
    connected_at: new Date().toISOString(), last_error: "",
  };
  const existing = await db.SocialAccount.filter({ user_id: userId, provider: record.provider, provider_account_id: String(record.accountId) }, "-created_date", 1, 0);
  return existing[0] ? db.SocialAccount.update(existing[0].id, payload) : db.SocialAccount.create(payload);
}
async function providerJson(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}), Authorization: "Bearer " + token } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || payload.error_description || payload.message || "Social provider request failed (HTTP " + response.status + ")."), { status: 502, code: "SOCIAL_PROVIDER_ERROR" });
  return payload;
}

export const createSocialMediaUploadUrl = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ fileName: z.string().min(1).max(180).regex(/^[a-zA-Z0-9._ -]+$/), contentType: z.enum(["video/mp4", "video/quicktime"]), sizeBytes: z.number().int().min(1).max(250 * 1024 * 1024) }))
  .handler(async ({ data, context }) => {
    const extension = data.contentType === "video/quicktime" ? "mov" : "mp4";
    const objectKey = "social/" + context.user.id + "/" + crypto.randomUUID() + "." + extension;
    const uploadUrl = await presignR2({ method: "PUT", objectKey, contentType: data.contentType, expiresIn: 300 });
    return { uploadUrl, objectKey, expiresInSeconds: 300, maxBytes: 250 * 1024 * 1024 };
  });

export const beginSocialOAuth = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ provider: z.enum(["TikTok", "Instagram", "YouTube", "X", "LinkedIn"]) }))
  .handler(async ({ data, context }) => {
    const provider = data.provider;
    const state = randomVerifier();
    const stateHash = await createSocialStateHash(state);
    const verifier = randomVerifier();
    const challenge = toBase64Url(await digestText(verifier));
    const db = context.getBase44().asServiceRole.entities;
    await db.SocialOAuthState.create({
      user_id: context.user.id, provider, state_hash: stateHash, code_verifier: verifier,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    let url;
    if (provider === "TikTok") {
      const clientKey = secrets.get("TIKTOK_CLIENT_KEY");
      if (!clientKey || !secrets.get("TIKTOK_CLIENT_SECRET")) throw Object.assign(new Error("TikTok app credentials are missing. Configure TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET."), { status: 503 });
      const params = new URLSearchParams({ client_key: clientKey, response_type: "code", scope: "user.info.basic,video.publish,video.upload", redirect_uri: SOCIAL_CALLBACK_URL, state, code_challenge: challenge, code_challenge_method: "S256" });
      url = "https://www.tiktok.com/v2/auth/authorize/?" + params;
    } else if (provider === "Instagram") {
      const clientId = secrets.get("META_APP_ID");
      if (!clientId || !secrets.get("META_APP_SECRET")) throw Object.assign(new Error("Meta app credentials are missing. Configure META_APP_ID and META_APP_SECRET."), { status: 503 });
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: SOCIAL_CALLBACK_URL, state, response_type: "code", scope: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts" });
      url = "https://www.facebook.com/v22.0/dialog/oauth?" + params;
    } else if (provider === "YouTube") {
      const clientId = secrets.get("GOOGLE_CLIENT_ID");
      if (!clientId || !secrets.get("GOOGLE_CLIENT_SECRET")) throw Object.assign(new Error("Google app credentials are missing. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."), { status: 503 });
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: SOCIAL_CALLBACK_URL, response_type: "code", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, code_challenge: challenge, code_challenge_method: "S256" });
      url = "https://accounts.google.com/o/oauth2/v2/auth?" + params;
    } else if (provider === "LinkedIn") {
      const clientId = secrets.get("LINKEDIN_CLIENT_ID");
      if (!clientId || !secrets.get("LINKEDIN_CLIENT_SECRET")) throw Object.assign(new Error("LinkedIn app credentials are missing. Configure LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET."), { status: 503 });
      const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: SOCIAL_CALLBACK_URL, state, scope: "openid profile w_member_social" });
      url = "https://www.linkedin.com/oauth/v2/authorization?" + params;
    } else {
      const clientId = secrets.get("X_CLIENT_ID");
      if (!clientId || !secrets.get("X_CLIENT_SECRET")) throw Object.assign(new Error("X developer app credentials are missing. Configure X_CLIENT_ID and X_CLIENT_SECRET."), { status: 503 });
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: SOCIAL_CALLBACK_URL, response_type: "code", scope: "tweet.read tweet.write users.read offline.access", state, code_challenge: challenge, code_challenge_method: "S256" });
      url = "https://twitter.com/i/oauth2/authorize?" + params;
    }
    return { authorizationUrl: url, provider };
  });

export const completeSocialOAuth = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ code: z.string().min(1).max(4096), state: z.string().min(16).max(256) }))
  .handler(async ({ data, context }) => {
    const stateHash = await createSocialStateHash(data.state);
    const db = context.getBase44().asServiceRole.entities;
    const states = await db.SocialOAuthState.filter({ user_id: context.user.id, state_hash: stateHash }, "-created_date", 1, 0);
    const state = states[0];
    if (!state || state.used_at || new Date(state.expires_at).getTime() < Date.now()) throw Object.assign(new Error("This social connection request has expired or was already used. Start the connection again."), { status: 400, code: "SOCIAL_OAUTH_STATE_INVALID" });
    await db.SocialOAuthState.update(state.id, { used_at: new Date().toISOString() });
    const provider = state.provider;
    const verifier = state.code_verifier;
    let saved = [];
    if (provider === "TikTok") {
      const clientKey = secrets.get("TIKTOK_CLIENT_KEY"), clientSecret = secrets.get("TIKTOK_CLIENT_SECRET");
      const body = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code: data.code, grant_type: "authorization_code", redirect_uri: SOCIAL_CALLBACK_URL, code_verifier: verifier });
      const token = await socialTokenRequest("https://open.tiktokapis.com/v2/oauth/token/", body);
      const profile = await providerJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", token.access_token);
      const userInfo = profile.data?.user || {};
      saved.push(await saveSocialAccount(db, context.user.id, { provider: "TikTok", accountId: token.open_id, accountName: userInfo.display_name || userInfo.username || "TikTok creator", accountType: "profile", accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + Number(token.expires_in || 86400) * 1000).toISOString(), refreshExpiresAt: new Date(Date.now() + Number(token.refresh_expires_in || 0) * 1000).toISOString(), scopes: String(token.scope || "").split(",").filter(Boolean), metadata: { username: userInfo.username || "" } }));
    } else if (provider === "Instagram") {
      const clientId = secrets.get("META_APP_ID"), clientSecret = secrets.get("META_APP_SECRET");
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: SOCIAL_CALLBACK_URL, code: data.code });
      const shortToken = await fetch("https://graph.facebook.com/v22.0/oauth/access_token?" + params).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message || "Meta OAuth exchange failed."); return p; });
      const longParams = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: shortToken.access_token });
      const longToken = await fetch("https://graph.facebook.com/v22.0/oauth/access_token?" + longParams).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message || "Meta long-lived token exchange failed."); return p; });
      const pages = await providerJson("https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}", longToken.access_token);
      for (const page of pages.data || []) {
        if (page.id && page.access_token) saved.push(await saveSocialAccount(db, context.user.id, { provider: "Facebook", accountId: page.id, accountName: page.name || "Facebook Page", accountType: "page", accessToken: page.access_token, expiresAt: new Date(Date.now() + Number(longToken.expires_in || 5184000) * 1000).toISOString(), scopes: ["pages_show_list", "pages_manage_posts"], metadata: { pageId: page.id } }));
        const ig = page.instagram_business_account;
        if (ig?.id && page.access_token) saved.push(await saveSocialAccount(db, context.user.id, { provider: "Instagram", accountId: ig.id, accountName: ig.username ? "@" + ig.username : "Instagram Business", accountType: "business", accessToken: page.access_token, expiresAt: new Date(Date.now() + Number(longToken.expires_in || 5184000) * 1000).toISOString(), scopes: ["instagram_basic", "instagram_content_publish"], metadata: { pageId: page.id, pageName: page.name || "" } }));
      }
      if (!saved.length) throw Object.assign(new Error("Meta authorised the account but returned no Facebook Page or Instagram Business account. Convert or link an Instagram professional account to a Facebook Page, then reconnect."), { status: 409, code: "META_NO_PUBLISHABLE_ACCOUNT" });
    } else if (provider === "YouTube") {
      const body = new URLSearchParams({ client_id: secrets.get("GOOGLE_CLIENT_ID"), client_secret: secrets.get("GOOGLE_CLIENT_SECRET"), code: data.code, grant_type: "authorization_code", redirect_uri: SOCIAL_CALLBACK_URL, code_verifier: verifier });
      const token = await socialTokenRequest("https://oauth2.googleapis.com/token", body);
      const channel = await providerJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", token.access_token);
      const item = channel.items?.[0];
      if (!item?.id) throw Object.assign(new Error("No YouTube channel was returned for this Google account."), { status: 409 });
      saved.push(await saveSocialAccount(db, context.user.id, { provider: "YouTube", accountId: item.id, accountName: item.snippet?.title || "YouTube channel", accountType: "channel", accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), scopes: ["youtube.upload", "youtube.readonly"], metadata: { channelId: item.id } }));
    } else if (provider === "X") {
      const body = new URLSearchParams({ client_id: secrets.get("X_CLIENT_ID"), code: data.code, grant_type: "authorization_code", redirect_uri: SOCIAL_CALLBACK_URL, code_verifier: verifier });
      const token = await socialTokenRequest("https://api.x.com/2/oauth2/token", body, secrets.get("X_CLIENT_ID"), secrets.get("X_CLIENT_SECRET"));
      const profile = await providerJson("https://api.x.com/2/users/me?user.fields=name,username", token.access_token);
      const userInfo = profile.data || {};
      if (!userInfo.id) throw new Error("X did not return the authorised profile.");
      saved.push(await saveSocialAccount(db, context.user.id, { provider: "X", accountId: userInfo.id, accountName: userInfo.name || userInfo.username || "X account", accountType: "profile", accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + Number(token.expires_in || 7200) * 1000).toISOString(), scopes: String(token.scope || "").split(" ").filter(Boolean), metadata: { username: userInfo.username || "" } }));
    } else if (provider === "LinkedIn") {
      const body = new URLSearchParams({ grant_type: "authorization_code", code: data.code, redirect_uri: SOCIAL_CALLBACK_URL, client_id: secrets.get("LINKEDIN_CLIENT_ID"), client_secret: secrets.get("LINKEDIN_CLIENT_SECRET") });
      const token = await socialTokenRequest("https://www.linkedin.com/oauth/v2/accessToken", body);
      const profile = await providerJson("https://api.linkedin.com/v2/userinfo", token.access_token);
      if (!profile.sub) throw new Error("LinkedIn did not return the authorised member profile.");
      const displayName = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(" ") || "LinkedIn member";
      saved.push(await saveSocialAccount(db, context.user.id, { provider: "LinkedIn", accountId: "urn:li:person:" + profile.sub, accountName: displayName, accountType: "profile", accessToken: token.access_token, expiresAt: new Date(Date.now() + Number(token.expires_in || 5184000) * 1000).toISOString(), scopes: ["openid", "profile", "w_member_social"], metadata: { subject: profile.sub, picture: profile.picture || "" } }));
    }
    for (const row of states) await db.SocialOAuthState.delete(row.id).catch(() => null);
    return { provider, connectedAccounts: saved.map(x => ({ id: x.id, provider: x.provider, accountName: x.account_name })), count: saved.length };
  });

export const getMySocialAccounts = createServerFn({ method: "GET" }).middleware([requireUser]).handler(async ({ context }) => {
  const rows = await context.getBase44().asServiceRole.entities.SocialAccount.filter({ user_id: context.user.id, status: "connected" }, "-connected_at", 100, 0);
  return rows.map(({ id, provider, provider_account_id, account_name, account_type, token_expires_at, scopes, status, connected_at, last_used_at, last_error }) => ({ id, provider, providerAccountId: provider_account_id, accountName: account_name, accountType: account_type, tokenExpiresAt: token_expires_at || null, scopes: scopes || [], status, connectedAt: connected_at, lastUsedAt: last_used_at || null, lastError: last_error || "" }));
});

export const disconnectSocialAccount = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ accountId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const db = context.getBase44().asServiceRole.entities.SocialAccount;
    const account = await db.get(data.accountId).catch(() => null);
    if (!account || account.user_id !== context.user.id) throw Object.assign(new Error("You can only disconnect a social account owned by your user."), { status: 403 });
    await db.update(account.id, { status: "disconnected", encrypted_access_token: "", encrypted_refresh_token: "", last_error: "" });
    return { success: true };
  });

async function getUsableSocialToken(db, account) {
  if (!account.encrypted_access_token) throw Object.assign(new Error("This social account has no usable credential. Reconnect it."), { status: 401 });
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (expiresAt && expiresAt < Date.now() + 120000) {
    if (!account.encrypted_refresh_token || !["TikTok", "YouTube", "X"].includes(account.provider)) {
      await db.SocialAccount.update(account.id, { status: "expired", last_error: "Token expired; reconnect this account." });
      throw Object.assign(new Error("The social connection has expired. Reconnect this account before publishing."), { status: 401, code: "SOCIAL_TOKEN_EXPIRED" });
    }
    const refreshToken = await decryptSocialToken(account.encrypted_refresh_token);
    let token;
    if (account.provider === "TikTok") {
      const body = new URLSearchParams({ client_key: secrets.get("TIKTOK_CLIENT_KEY"), client_secret: secrets.get("TIKTOK_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: refreshToken });
      token = await socialTokenRequest("https://open.tiktokapis.com/v2/oauth/token/", body);
    } else if (account.provider === "YouTube") {
      const body = new URLSearchParams({ client_id: secrets.get("GOOGLE_CLIENT_ID"), client_secret: secrets.get("GOOGLE_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: refreshToken });
      token = await socialTokenRequest("https://oauth2.googleapis.com/token", body);
    } else {
      const body = new URLSearchParams({ client_id: secrets.get("X_CLIENT_ID"), grant_type: "refresh_token", refresh_token: refreshToken });
      token = await socialTokenRequest("https://api.x.com/2/oauth2/token", body, secrets.get("X_CLIENT_ID"), secrets.get("X_CLIENT_SECRET"));
    }
    account = await db.SocialAccount.update(account.id, {
      encrypted_access_token: await encryptSocialToken(token.access_token),
      ...(token.refresh_token ? { encrypted_refresh_token: await encryptSocialToken(token.refresh_token) } : {}),
      token_expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
      status: "connected", last_error: "",
    });
  }
  return decryptSocialToken(account.encrypted_access_token);
}

async function publishSocialPostForUser(context, postId) {
  const db = context.getBase44().asServiceRole.entities;
  const post = await db.SocialPost.get(postId).catch(() => null);
  if (!post || post.user_id !== context.user.id) throw Object.assign(new Error("This publication does not belong to your account."), { status: 403 });
  if (post.status === "published" || post.status === "publishing") throw Object.assign(new Error("This publication has already been sent or is still processing."), { status: 409 });
  const account = await db.SocialAccount.get(post.account_id).catch(() => null);
  if (!account || account.user_id !== context.user.id || account.provider !== post.platform || account.status !== "connected") throw Object.assign(new Error("Connect and select your own account for this network before publishing."), { status: 409, code: "SOCIAL_ACCOUNT_REQUIRED" });
  let mediaUrl = post.media_reference || "";
  if (post.media_type === "video" && mediaUrl.startsWith("social/" + context.user.id + "/")) mediaUrl = await presignR2({ method: "GET", objectKey: mediaUrl, expiresIn: 3600 });
  if (post.media_type === "video" && !mediaUrl.startsWith("https://")) throw Object.assign(new Error("Video publishing requires your uploaded private video or a publicly reachable HTTPS URL."), { status: 400 });
  const token = await getUsableSocialToken(db, account);
  const claim = await db.SocialPost.updateMany({ id: post.id, status: { $in: ["draft", "failed", "scheduled"] } }, { $set: { status: "publishing", last_attempt_at: new Date().toISOString(), error_message: "" } });
  if (!claim?.updated) throw Object.assign(new Error("Another publication process has already claimed this post."), { status: 409, code: "SOCIAL_POST_ALREADY_CLAIMED" });
  try {
    let externalId = "";
    if (post.platform === "Instagram") {
      if (post.media_type !== "video") throw new Error("Instagram Reels publishing requires a video URL.");
      const form = new URLSearchParams({ media_type: "REELS", video_url: mediaUrl, caption: post.caption, access_token: token });
      const container = await fetch("https://graph.facebook.com/v22.0/" + encodeURIComponent(account.provider_account_id) + "/media", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message || "Instagram media container creation failed."); return p; });
      if (!container.id) throw new Error("Instagram did not return a media container.");
      let ready = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        const status = await fetch("https://graph.facebook.com/v22.0/" + encodeURIComponent(container.id) + "?fields=status_code&access_token=" + encodeURIComponent(token)).then(r => r.json());
        if (status.status_code === "FINISHED") { ready = true; break; }
        if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error("Instagram could not process the video. Check codec, duration and aspect ratio.");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (!ready) throw new Error("Instagram is still processing this video. Save the draft and retry publication shortly.");
      const publishForm = new URLSearchParams({ creation_id: container.id, access_token: token });
      const published = await fetch("https://graph.facebook.com/v22.0/" + encodeURIComponent(account.provider_account_id) + "/media_publish", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: publishForm.toString() }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message || "Instagram publication failed."); return p; });
      externalId = published.id;
    } else if (post.platform === "Facebook") {
      if (post.media_type !== "video") throw new Error("Facebook Page video publishing requires a video URL.");
      const form = new URLSearchParams({ file_url: mediaUrl, description: post.caption, access_token: token });
      const published = await fetch("https://graph.facebook.com/v22.0/" + encodeURIComponent(account.provider_account_id) + "/videos", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message || "Facebook video publication failed."); return p; });
      externalId = published.id;
    } else if (post.platform === "TikTok") {
      if (post.media_type !== "video") throw new Error("TikTok publishing requires a video URL.");
      const creator = await providerJson("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const privacy = creator.data?.privacy_level_options?.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : creator.data?.privacy_level_options?.[0];
      if (!privacy) throw new Error("TikTok did not return an available privacy setting for this account.");
      const response = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ post_info: { title: post.caption.slice(0, 150), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: "PULL_FROM_URL", video_url: mediaUrl } }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error?.code && payload.error.code !== "ok") throw new Error(payload.error?.message || "TikTok rejected the video publication.");
      externalId = payload.data?.publish_id || "";
    } else if (post.platform === "YouTube") {
      if (post.media_type !== "video") throw new Error("YouTube upload requires a video URL.");
      const mediaResponse = await fetch(mediaUrl);
      if (!mediaResponse.ok) throw new Error("The video URL could not be downloaded for YouTube upload.");
      const length = Number(mediaResponse.headers.get("content-length") || 0);
      if (length > 256 * 1024 * 1024) throw new Error("This initial YouTube upload path is limited to 256 MB per video.");
      const media = await mediaResponse.arrayBuffer();
      if (media.byteLength > 256 * 1024 * 1024) throw new Error("This initial YouTube upload path is limited to 256 MB per video.");
      const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(media.byteLength) }, body: JSON.stringify({ snippet: { title: post.caption.slice(0, 100), description: post.caption, categoryId: "20" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } }) });
      if (!init.ok) throw new Error("YouTube upload initialisation failed (HTTP " + init.status + ").");
      const uploadUrl = init.headers.get("location");
      if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(media.byteLength) }, body: media });
      const result = await uploaded.json().catch(() => ({}));
      if (!uploaded.ok) throw new Error(result.error?.message || "YouTube video upload failed.");
      externalId = result.id || "";
    } else if (post.platform === "X") {
      if (post.media_type === "video") throw new Error("X video upload is not enabled in this release. Publish text posts on X; use Instagram, Facebook, TikTok or YouTube for video.");
      const published = await providerJson("https://api.x.com/2/tweets", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: post.caption }) });
      externalId = published.data?.id || "";
    } else if (post.platform === "LinkedIn") {
      if (post.media_type === "video") throw new Error("LinkedIn media publishing is not enabled in this release. Publish a text post on LinkedIn.");
      const response = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers: { Authorization: "Bearer " + token, "LinkedIn-Version": "202609", "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" }, body: JSON.stringify({ author: account.provider_account_id, commentary: post.caption, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.serviceErrorCode || "LinkedIn publication failed (HTTP " + response.status + ").");
      externalId = response.headers.get("x-restli-id") || payload.id || "";
    }
    const finalStatus = post.platform === "TikTok" ? "publishing" : "published";
    const postPatch = { status: finalStatus, external_post_id: externalId, error_message: "" };
    if (finalStatus === "published") postPatch.published_at = new Date().toISOString();
    const updated = await db.SocialPost.update(post.id, postPatch);
    await db.SocialAccount.update(account.id, { last_used_at: new Date().toISOString(), last_error: "" });
    return { success: true, status: updated.status, externalPostId: externalId, message: finalStatus === "publishing" ? "TikTok accepted the video. Processing and moderation continue on TikTok." : "Published successfully." };
  } catch (error) {
    await db.SocialPost.update(post.id, { status: "failed", error_message: String(error.message || error).slice(0, 500) });
    await db.SocialAccount.update(account.id, { last_error: String(error.message || error).slice(0, 1000) });
    throw error;
  }
}

export const publishSocialPost = createServerFn({ method: "POST" }).middleware([requireUser])
  .validator(z.object({ postId: z.string().min(1) }))
  .handler(async ({ data, context }) => publishSocialPostForUser(context, data.postId));

export const processMyDueSocialPosts = createServerFn({ method: "POST" }).middleware([requireUser]).handler(async ({ context }) => {
  const rows = await context.getBase44().asServiceRole.entities.SocialPost.filter({ user_id: context.user.id, status: "scheduled" }, "scheduled_at", 30, 0);
  const due = rows.filter(post => post.scheduled_at && new Date(post.scheduled_at).getTime() <= Date.now());
  const results = [];
  for (const post of due) {
    try { results.push({ postId: post.id, ...(await publishSocialPostForUser(context, post.id)) }); }
    catch (error) { results.push({ postId: post.id, success: false, error: String(error.message || error) }); }
  }
  return { processed: results.length, results };
});

export const getPublicCommunityReviews = createServerFn({method:"GET"}).handler(async({context})=>{
 const rows=await context.getBase44().asServiceRole.entities.CommunityReview.filter({status:"published"},"-created_date",18,0);
 return rows.map(({user_id,moderation_note,...review})=>review);
});
export const submitCommunityReview = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({rating:z.number().int().min(1).max(5),title:z.string().trim().min(3).max(90),reviewText:z.string().trim().min(20).max(800)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities.CommunityReview;
  const recent=await db.filter({user_id:context.user.id},"-created_date",10,0);
  const cutoff=Date.now()-30*86400000;
  if(recent.some(row=>new Date(row.created_date||row.created_at||0).getTime()>cutoff))throw Object.assign(new Error("You can submit one review every 30 days. Your previous review is already in the moderation queue."),{status:429,code:"REVIEW_RATE_LIMIT"});
  const displayName=String(context.user.full_name||context.user.name||context.user.email||"VICEHUB member").split("@")[0].slice(0,60);
  await db.create({user_id:context.user.id,display_name:displayName,rating:data.rating,title:data.title,review_text:data.reviewText,status:"pending"});
  return {ok:true,message:"Review received. It will appear after moderation."};
 });
export const getAdminCommunityReviews = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.CommunityReview.list("-created_date",200,0);
});
export const setCommunityReviewStatus = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({reviewId:z.string().min(1),status:z.enum(["published","rejected"])}))
 .handler(async({data,context})=>{
  requireAdmin(context);
  return context.getBase44().asServiceRole.entities.CommunityReview.update(data.reviewId,{status:data.status,moderated_by:context.user.id,moderated_at:new Date().toISOString()});
 });
