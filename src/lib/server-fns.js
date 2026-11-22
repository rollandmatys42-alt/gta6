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
        if(!title || !articleUrl.startsWith("https://")) continue;
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
  const posts=await db.ForumPost.filter({thread_id:data.threadId,status:"published"},"created_date",100,0);
  return {thread,posts};
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
  if(subs[0]?.tier_code!=="premium" || subs[0]?.status!=="active") throw Object.assign(new Error("A Premium membership is required to publish creator listings. You can prepare a draft after Premium billing is enabled."),{status:403,code:"PREMIUM_REQUIRED"});
  const payload={seller_id:context.user.id,seller_name:context.user.full_name||context.user.email||"Creator",title:data.title,description:data.description,category:data.category,price_cents:data.priceCents,currency:data.currency,license_terms:data.licenseTerms,status:"pending_review",created_by:context.user.id,...(data.previewUrl?{preview_url:data.previewUrl}:{})};
  return data.id?db.MarketplaceListing.update(data.id,payload):db.MarketplaceListing.create(payload);
 });
export const createMarketplaceInquiry = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({listingId:z.string().min(1),message:z.string().min(5).max(2000)}))
 .handler(async({data,context})=>{
  const db=context.getBase44().asServiceRole.entities,listing=await db.MarketplaceListing.get(data.listingId).catch(()=>null);
  if(!listing||listing.status!=="published") throw Object.assign(new Error("Listing not found."),{status:404});
  if(listing.seller_id===context.user.id) throw Object.assign(new Error("You cannot contact yourself."),{status:400});
  return db.MarketplaceInquiry.create({listing_id:listing.id,buyer_id:context.user.id,seller_id:listing.seller_id,message:data.message,status:"open"});
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

export const getAdminOverview = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
 const [users,news,threads,listings,products,reports,downloads]=await Promise.all([
  context.getBase44().asServiceRole.users.list().catch(()=>[]),
  db.NewsArticle.list("-created_date",200,0),db.ForumThread.list("-created_date",200,0),
  db.MarketplaceListing.list("-created_date",200,0),db.ShopProduct.list("-created_date",200,0),
  db.ContentReport.filter({status:"open"},"-created_date",100,0),db.DownloadEvent.list("-created_date",500,0)
 ]);
 return {users:users.length,news:news.length,publishedNews:news.filter(x=>x.status==="published").length,threads:threads.length,listings:listings.length,products:products.length,openReports:reports.length,downloads:downloads.length};
});
export const getAdminReports = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);return context.getBase44().asServiceRole.entities.ContentReport.list("-created_date",100,0);
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
 .handler(async({data,context})=>{const db=context.getBase44().asServiceRole.entities.SocialPost;const p={user_id:context.user.id,platform:data.platform,caption:data.caption,status:"draft",...(data.scheduledAt?{scheduled_at:data.scheduledAt}:{})};return data.id?db.update(data.id,p):db.create(p);});
export const getMyMarketplaceInquiries = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{
 const db=context.getBase44().asServiceRole.entities;const [buyer,seller]=await Promise.all([db.MarketplaceInquiry.filter({buyer_id:context.user.id},"-created_date",50,0),db.MarketplaceInquiry.filter({seller_id:context.user.id},"-created_date",50,0)]);return {buyer,seller};
});

export const seedPlatformDefaults = createServerFn({method:"POST"}).middleware([requireUser]).handler(async({context})=>{
 requireAdmin(context);const db=context.getBase44().asServiceRole.entities;
 const categories=[["General","general","General GTA VI discussion"],["News & Updates","news-updates","Official updates and reported news"],["Gameplay","gameplay","Missions, mechanics and discoveries"],["Creative Work","creative-work","Edits, cinematics and creator showcases"],["Help & Tutorials","help-tutorials","Editing workflows and technical help"]];
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
 return {categoriesCreated:categoryCount,pagesCreated:pageCount,legalPagesRequireReview:true};
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
 const rows=await context.getBase44().asServiceRole.entities.SubscriptionPlan.filter({status:"active",currency:data.currency},"sort_order",20,0);
 return rows;
});
export const getAdminPlans = createServerFn({method:"GET"}).middleware([requireUser]).handler(async({context})=>{requireAdmin(context);return context.getBase44().asServiceRole.entities.SubscriptionPlan.list("sort_order",100,0);});
export const saveAdminPlan = createServerFn({method:"POST"}).middleware([requireUser])
 .validator(z.object({id:z.string().optional(),tierCode:z.enum(["starter","pro","premium"]),displayName:z.string().min(2).max(50),monthlyPriceCents:z.number().int().min(0),currency:z.enum(["USD","EUR","GBP"]),monthlyDownloadLimit:z.number().int().min(0),cleanDownloads:z.boolean(),marketplaceEnabled:z.boolean(),status:z.enum(["draft","active","archived"]),loyaltyMonthlyDiscountPercent:z.number().min(0).max(100),loyaltyMaxDiscountPercent:z.number().min(0).max(100),loyaltyFloorPriceCents:z.number().int().min(0),sortOrder:z.number().int()}))
 .handler(async({data,context})=>{requireAdmin(context);const db=context.getBase44().asServiceRole.entities.SubscriptionPlan;const p={tier_code:data.tierCode,display_name:data.displayName,monthly_price_cents:data.monthlyPriceCents,currency:data.currency,monthly_download_limit:data.monthlyDownloadLimit,clean_downloads:data.cleanDownloads,marketplace_enabled:data.marketplaceEnabled,status:data.status,loyalty_monthly_discount_percent:data.loyaltyMonthlyDiscountPercent,loyalty_max_discount_percent:data.loyaltyMaxDiscountPercent,loyalty_floor_price_cents:data.loyaltyFloorPriceCents,sort_order:data.sortOrder};return data.id?db.update(data.id,p):db.create(p);});
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
