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
    const tier = subscription?.status === "active" || (subscription?.status === "past_due" && subscription?.grace_period_ends_at && new Date(subscription.grace_period_ends_at) > new Date()) ? (subscription.tier_code || "free") : "free";
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
 return context.getBase44().asServiceRole.entities.ShopProduct.filter({status:"published"},"-created_date",100,0);
});
export const getAdminShopProducts = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.ShopProduct.list("-created_date",100,0);
});
export const saveShopProduct = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),title:z.string().min(2).max(160),description:z.string().max(5000),productType:z.enum(["physical","digital"]),priceCents:z.number().int().min(0),currency:z.enum(["USD","EUR","GBP"]),stockQuantity:z.number().int().min(0).optional(),imageUrl:z.string().url().optional(),status:z.enum(["draft","published","archived"]),sku:z.string().max(80).optional()}))
 .handler(async({data,context})=>{
  requireAdmin(context);const db=context.getBase44().asServiceRole.entities.ShopProduct;
  const p={title:data.title,description:data.description,product_type:data.productType,price_cents:data.priceCents,currency:data.currency,stock_quantity:data.stockQuantity||0,status:data.status,...(data.imageUrl?{image_url:data.imageUrl}:{}),sku:data.sku||""};
  return data.id?db.update(data.id,p):db.create(p);
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
 for(const subscription of subscriptions)await db.UserSubscription.update(subscription.id,{user_id:"deleted:"+data.userId,stripe_customer_id:"",stripe_subscription_id:""});
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
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const [videos,metrics]=await Promise.all([db.Video.list("-created_date",2000,0),db.VideoPerformanceMetric.list("-created_date",5000,0)]);const byVideo=new Map();for(const metric of metrics){if(!byVideo.has(metric.video_id))byVideo.set(metric.video_id,[]);byVideo.get(metric.video_id).push(metric);}return videos.map(video=>{const rows=byVideo.get(video.id)||[];const totals=rows.reduce((a,m)=>({views:a.views+(Number(m.views)||0),impressions:a.impressions+(Number(m.impressions)||0),likes:a.likes+(Number(m.likes)||0),comments:a.comments+(Number(m.comments)||0),shares:a.shares+(Number(m.shares)||0),saves:a.saves+(Number(m.saves)||0),watchWeighted:a.watchWeighted+(Number(m.average_watch_seconds)||0)*(Number(m.views)||0),watchViews:a.watchViews+(Number(m.views)||0),length:Number(m.video_length_seconds)||a.length}),{views:0,impressions:0,likes:0,comments:0,shares:0,saves:0,watchWeighted:0,watchViews:0,length:Number(video.duration_seconds)||0});const interactions=totals.likes+totals.comments+totals.shares+totals.saves;return {...video,metrics:totals,engagementRate:totals.views?interactions/totals.views*100:null,shareRate:totals.views?totals.shares/totals.views*100:null,retentionRate:totals.length&&totals.watchViews?Math.min(100,totals.watchWeighted/totals.watchViews/totals.length*100):null,metricRows:rows.length};}).sort((a,b)=>(b.metrics.shares-a.metrics.shares)||(b.metrics.views-a.metrics.views));
});
export const saveVideoPerformanceMetric = createServerFn({method:"POST"}).middleware([requireUser]).validator(z.object({videoId:z.string().min(1),platform:z.enum(["TikTok","Instagram","YouTube","Other"]),periodStart:z.string().optional(),periodEnd:z.string().optional(),views:z.number().int().min(0),impressions:z.number().int().min(0),likes:z.number().int().min(0),comments:z.number().int().min(0),shares:z.number().int().min(0),saves:z.number().int().min(0),averageWatchSeconds:z.number().min(0),videoLengthSeconds:z.number().min(0),profileClicks:z.number().int().min(0),followersGained:z.number().int().min(0)})).handler(async({data,context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const video=await db.Video.get(data.videoId).catch(()=>null);if(!video)throw Object.assign(new Error("The selected video no longer exists."),{status:404});if(data.impressions&&data.views>data.impressions*10)throw Object.assign(new Error("Views are inconsistent with impressions; check the source metrics."),{status:400});return db.VideoPerformanceMetric.create({video_id:data.videoId,platform:data.platform,...(data.periodStart?{period_start:data.periodStart}:{}),...(data.periodEnd?{period_end:data.periodEnd}:{}),views:data.views,impressions:data.impressions,likes:data.likes,comments:data.comments,shares:data.shares,saves:data.saves,average_watch_seconds:data.averageWatchSeconds,video_length_seconds:data.videoLengthSeconds,profile_clicks:data.profileClicks,followers_gained:data.followersGained,source:"manual"});
});
export const getAdminFinanceSnapshot = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;const [subscriptions,plans,invoices,promotions,payments]=await Promise.all([db.UserSubscription.list("-created_date",5000,0),db.SubscriptionPlan.list("sort_order",500,0),db.PlatformInvoice.list("-created_date",1000,0),db.SubscriberPromotion.list("-created_date",500,0),db.PaymentLedgerEntry.list("-created_date",5000,0)]);
 const active=subscriptions.filter(s=>s.status==="active"||s.status==="trialing"||(s.status==="past_due"&&s.grace_period_ends_at&&new Date(s.grace_period_ends_at)>new Date()));const currencies=["GBP","EUR","USD"].map(currency=>{const rows=active.filter(s=>s.currency===currency);return {currency,subscriptions:rows.length,mrrCents:rows.reduce((sum,s)=>sum+Math.max(0,Number(s.current_monthly_price_cents)||0),0)};});
 const paid=payments.filter(p=>p.status==="paid"||p.status==="refunded");const currentYear=new Date().getUTCFullYear();const monthlyRevenue=Array.from({length:12},(_,month)=>({month:month+1,label:new Date(Date.UTC(currentYear,month,1)).toLocaleString("en-GB",{month:"short",timeZone:"UTC"}),GBP:0,EUR:0,USD:0}));for(const p of paid){const d=new Date(p.paid_at||p.created_date);if(!Number.isFinite(d.getTime())||d.getUTCFullYear()!==currentYear)continue;const c=p.currency;if(["GBP","EUR","USD"].includes(c))monthlyRevenue[d.getUTCMonth()][c]+=Number(p.amount_paid_cents||0);}
 const yearlyRevenue=[currentYear-2,currentYear-1,currentYear].map(year=>({year,GBP:0,EUR:0,USD:0}));for(const p of paid){const d=new Date(p.paid_at||p.created_date);const row=yearlyRevenue.find(x=>x.year===d.getUTCFullYear());if(row&&["GBP","EUR","USD"].includes(p.currency))row[p.currency]+=Number(p.amount_paid_cents||0);}
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
 return {
  aiProviderConfigured:Boolean(secrets.get("AI_ROUTER_API_KEY")),
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
  socialPublishing:{tiktokConfigured,instagramConfigured,youtubeConfigured},
  recurringAgentScheduler:"manual_only"
 };
});
export const updateReportStatus = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string(),status:z.enum(["reviewing","resolved","dismissed"])}))
 .handler(async({data,context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.ContentReport.update(data.id,{status:data.status});});

export const generateStudioDraft = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({platform:z.enum(["TikTok","Instagram","YouTube","X","General"]),contentType:z.enum(["Title","Hook","Caption","Description","Hashtags","Script","SEO","GEO"]),topic:z.string().min(5).max(1000),tone:z.enum(["Cinematic","Energetic","Informative","Professional"]).default("Energetic"),language:z.enum(["English","French","Spanish","German","Italian","Portuguese"]).default("English")}))
 .handler(async({data,context})=>{
  const key=secrets.get("AI_ROUTER_API_KEY");
  if(!key) throw Object.assign(new Error("AI provider not connected. Configure AI_ROUTER_API_KEY in Base44 secrets to activate generation."),{status:503,code:"AI_PROVIDER_NOT_CONFIGURED"});
  const base=secrets.get("AI_ROUTER_BASE_URL")||"https://openrouter.ai/api/v1";
  const model=secrets.get("AI_ROUTER_MODEL")||"openai/gpt-4o-mini";
  const prompt="You are a professional GTA VI creator marketing assistant. Generate "+data.contentType+" for "+data.platform+". Topic: "+data.topic+". Tone: "+data.tone+". Language: "+data.language+". Keep claims factual, never present leaks or rumours as confirmed, and do not imply affiliation with Rockstar Games. Return only usable content.";
  const response=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","HTTP-Referer":"https://gta6-creator-hub-c26cc578.base44.app","X-Title":"VICEHUB Creator Studio"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0.7,max_tokens:1400})});
  if(!response.ok) throw Object.assign(new Error("AI provider error: HTTP "+response.status),{status:502,code:"AI_PROVIDER_ERROR"});
  const payload=await response.json();const output=payload.choices?.[0]?.message?.content;
  if(!output) throw new Error("AI provider returned an empty response.");
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
export const getMySocialPosts = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>context.getBase44().asServiceRole.entities.SocialPost.filter({user_id:context.user.id},"-created_date",50,0));
export const saveSocialPost = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),platform:z.enum(["TikTok","Instagram","YouTube","X"]),caption:z.string().min(1).max(5000),scheduledAt:z.string().datetime().optional()}))
 .handler(async({data,context})=>{const db=context.getBase44().asServiceRole.entities.SocialPost;if(data.scheduledAt&&new Date(data.scheduledAt)<=new Date())throw Object.assign(new Error("Choose a future date for your planning reminder."),{status:400});const p={user_id:context.user.id,platform:data.platform,caption:data.caption,status:"draft",...(data.scheduledAt?{scheduled_at:data.scheduledAt}:{})};if(data.id){const existing=await db.get(data.id).catch(()=>null);if(!existing||existing.user_id!==context.user.id)throw Object.assign(new Error("You can only edit your own social drafts."),{status:403});return db.update(existing.id,p);}return db.create(p);});
export const deleteSocialPost = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({postId:z.string().min(1)}))
 .handler(async({data,context})=>{const db=context.getBase44().asServiceRole.entities.SocialPost;const post=await db.get(data.postId).catch(()=>null);if(!post||post.user_id!==context.user.id)throw Object.assign(new Error("You can only delete your own social drafts."),{status:403});await db.delete(post.id);return {success:true};});
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
  const key=secrets.get("AI_ROUTER_API_KEY");if(!key)throw Object.assign(new Error("AI provider not connected. Configure AI_ROUTER_API_KEY in Base44 secrets."),{status:503,code:"AI_PROVIDER_NOT_CONFIGURED"});
  const base=secrets.get("AI_ROUTER_BASE_URL")||"https://openrouter.ai/api/v1",model=agent.provider_model||secrets.get("AI_ROUTER_MODEL")||"openai/gpt-4o-mini";
  const response=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","HTTP-Referer":"https://gta6-creator-hub-c26cc578.base44.app","X-Title":"VICEHUB Agent"},body:JSON.stringify({model,messages:[{role:"system",content:agent.instructions},{role:"user",content:data.taskInput}],temperature:0.4,max_tokens:1800})});
  if(!response.ok)throw Object.assign(new Error("AI provider error: HTTP "+response.status),{status:502});
  const result=await response.json(),output=result.choices?.[0]?.message?.content;if(!output)throw new Error("AI provider returned an empty result.");
  const saved=await db.AIContentDraft.create({user_id:context.user.id,platform:"General",content_type:agent.agent_key==="seo_agent"?"SEO":agent.agent_key==="geo_agent"?"GEO":agent.agent_key==="social_agent"?"Caption":"Description",topic:data.taskInput,output,status:"draft",provider:model});
  await db.AIAgentConfig.update(agent.id,{last_run_at:new Date().toISOString(),last_run_status:"Completed successfully"});
  return {output,draftId:saved.id,model};
 });

export const createContentReport = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({targetType:z.enum(["news","thread","post","listing","product"]),targetId:z.string().min(1),reason:z.enum(["copyright","spam","abuse","misinformation","other"]),details:z.string().max(2000).optional()}))
 .handler(async({data,context})=>context.getBase44().asServiceRole.entities.ContentReport.create({reporter_id:context.user.id,target_type:data.targetType,target_id:data.targetId,reason:data.reason,details:data.details||"",status:"open"}));

export const getPublicPlans = createServerFn({method:"GET"}).validator(z.object({currency:z.enum(["USD","EUR","GBP"]).default("USD")})).handler(async({data,context})=>{
 const rows=await context.getBase44().asServiceRole.entities.SubscriptionPlan.filter({status:"active",currency:data.currency,monthly_price_cents:{$gt:0},monthly_download_limit:{$gt:0}},"sort_order",20,0);
 return rows;
});
export const getAdminPlans = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.SubscriptionPlan.list("sort_order",100,0);});
export const saveAdminPlan = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),tierCode:z.enum(["starter","pro","premium"]),displayName:z.string().min(2).max(50),monthlyPriceCents:z.number().int().min(0),currency:z.enum(["USD","EUR","GBP"]),monthlyDownloadLimit:z.number().int().min(0),cleanDownloads:z.boolean(),marketplaceEnabled:z.boolean(),status:z.enum(["draft","active","archived"]),loyaltyMonthlyDiscountPercent:z.number().min(0).max(100),loyaltyMaxDiscountPercent:z.number().min(0).max(100),loyaltyFloorPriceCents:z.number().int().min(0),sortOrder:z.number().int()}))
 .handler(async({data,context})=>{requireAdmin(context);const db=context.getBase44().asServiceRole.entities.SubscriptionPlan;const p={tier_code:data.tierCode,display_name:data.displayName,monthly_price_cents:data.monthlyPriceCents,currency:data.currency,monthly_download_limit:data.monthlyDownloadLimit,clean_downloads:data.cleanDownloads,marketplace_enabled:data.marketplaceEnabled,status:data.status,loyalty_monthly_discount_percent:data.loyaltyMonthlyDiscountPercent,loyalty_max_discount_percent:data.loyaltyMaxDiscountPercent,loyalty_floor_price_cents:data.loyaltyFloorPriceCents,sort_order:data.sortOrder};if(data.id){const existing=await db.get(data.id);if(existing&&(Number(existing.monthly_price_cents)!==data.monthlyPriceCents||existing.currency!==data.currency))p.stripe_price_id=null;return db.update(data.id,p);}return db.create(p);});
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
  const streak=active?Number(sub?.streak_months||0):0;
  const discount=Math.min(Number(plan.loyalty_max_discount_percent||0),streak*Number(plan.loyalty_monthly_discount_percent||0));
  const raw=Math.round(Number(plan.monthly_price_cents||0)*(1-discount/100));
  const price=Math.max(Number(plan.loyalty_floor_price_cents||0),raw);
  return {tierCode:data.tierCode,currency:data.currency,basePriceCents:plan.monthly_price_cents,currentPriceCents:price,streakMonths:streak,discountPercent:discount,floorPriceCents:plan.loyalty_floor_price_cents||0,resetOnVoluntaryCancellation:true};
 });


const STRIPE_SITE_URL = "https://gta6-creator-hub-c26cc578.base44.app";
async function stripeApi(path, method = "GET", body = null) {
  const key = secrets.get("STRIPE_SECRET_KEY");
  if (!key) throw Object.assign(new Error("Stripe billing is not configured yet. Add STRIPE_SECRET_KEY in the secure app secrets before opening paid memberships."), { status: 503, code: "STRIPE_NOT_CONFIGURED" });
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: { Authorization: "Bearer " + key, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
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
  .validator(z.object({tierCode:z.enum(["starter","pro","premium"]),currency:z.enum(["USD","EUR","GBP"])}))
  .handler(async({data,context})=>{
    const db=context.getBase44().asServiceRole.entities;
    const user=context.user;
    const plans=await db.SubscriptionPlan.filter({tier_code:data.tierCode,currency:data.currency,status:"active"},"-created_date",1,0);
    const plan=plans[0];
    if(!plan||Number(plan.monthly_price_cents||0)<=0||Number(plan.monthly_download_limit||0)<1)throw Object.assign(new Error("This membership is not yet open for sale. The administrator must configure a positive monthly price and download allowance first."),{status:409,code:"PLAN_NOT_CONFIGURED"});
    const existingRows=await db.UserSubscription.filter({user_id:user.id},"-created_date",1,0);
    const existing=existingRows[0];
    if(existing?.status==="active"||existing?.status==="trialing"||existing?.status==="past_due")throw Object.assign(new Error("You already have a current or overdue membership. Use Manage membership to update payment details or cancel it; do not create a second subscription."),{status:409,code:"SUBSCRIPTION_ALREADY_ACTIVE"});
    const streak=existing?.status==="active"&&!existing?.voluntary_cancelled?Number(existing.streak_months||0):0;
    const discount=Math.min(Number(plan.loyalty_max_discount_percent||0),streak*Number(plan.loyalty_monthly_discount_percent||0));
    const priceCents=Math.max(Number(plan.loyalty_floor_price_cents||0),Math.round(Number(plan.monthly_price_cents)*(1-discount/100)));
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
      priceForm.set("unit_amount",String(Number(plan.monthly_price_cents)));
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
    form.set("subscription_data[metadata][user_id]",user.id);
    form.set("subscription_data[metadata][tier_code]",data.tierCode);
    form.set("subscription_data[metadata][currency]",data.currency);
    form.set("subscription_data[metadata][monthly_price_cents]",String(priceCents));
    form.set("subscription_data[metadata][discount_percent]",String(discount));
    form.set("line_items[0][price]",stripePriceId);
    form.set("line_items[0][quantity]","1");
    form.set("billing_address_collection","auto");
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
    return {success:true,tierCode,status,currency,priceCents,startedAt};
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
 const key=secrets.get("AI_ROUTER_API_KEY");
 if(!key)throw Object.assign(new Error("AI provider not connected. Configure AI_ROUTER_API_KEY in Base44 secrets."),{status:503,code:"AI_PROVIDER_NOT_CONFIGURED"});
 const base=secrets.get("AI_ROUTER_BASE_URL")||"https://openrouter.ai/api/v1";
 const model=secrets.get("AI_ROUTER_MODEL")||"openai/gpt-4o-mini";
 const response=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model,messages:[{role:"system",content:"Translate the provided "+contextLabel+" faithfully into "+targetLanguage+". Preserve meaning, factual distinctions, proper names, URLs, HTML/Markdown structure and all GTA VI trademark disclaimers. Return only a valid JSON object with translated fields."},{role:"user",content:sourceText}],temperature:0.2,max_tokens:4000})});
 if(!response.ok)throw Object.assign(new Error("Translation provider error: HTTP "+response.status),{status:502});
 const raw=(await response.json()).choices?.[0]?.message?.content||"";
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
