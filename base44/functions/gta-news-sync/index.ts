import { createClientFromRequest } from "npm:@base44/sdk";

const GTA_PATTERN = /\b(?:gta\s*(?:vi|6)|gta6|grand theft auto\s*vi)\b/i;
const ALLOWED_HOSTS = new Set([
  "rockstargames.com", "www.rockstargames.com",
  "youtube.com", "www.youtube.com",
  "gtaboom.com", "www.gtaboom.com",
  "gtabase.com", "www.gtabase.com",
  "gamespot.com", "www.gamespot.com",
  "ign.com", "www.ign.com",
  "rockstarintel.com", "www.rockstarintel.com",
  "api.x.com", "api.twitter.com", "reddit.com", "www.reddit.com",
]);

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}
function readTag(block: string, tag: string) {
  const match = block.match(new RegExp("<(?:[a-z0-9_-]+:)?"+tag+"\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?"+tag+">", "i"));
  return match ? decodeXml(match[1]) : "";
}
function safeImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString().slice(0, 1800);
  } catch { return ""; }
}
function readImage(block: string) {
  const candidates = [
    block.match(/<(?:media:)?thumbnail\b[^>]*url=["']([^"']+)["']/i)?.[1],
    block.match(/<media:content\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\//i)?.[1],
    block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\//i)?.[1],
    block.match(/<itunes:image\b[^>]*href=["']([^"']+)["']/i)?.[1],
    block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1],
  ];
  return safeImageUrl(candidates.find(Boolean) || "");
}
function validateSourceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Only public HTTPS source URLs on the standard port are allowed.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Source hostname is not allowlisted for automated ingestion: " + url.hostname);
  }
  return url;
}
async function generateEditorial(source: any, title: string, summary: string, articleUrl: string) {
  const fallback = { title: title.slice(0,180), summary: summary.slice(0,500), body: summary.slice(0,2000) || title };
  const key = Deno.env.get("OMNIROUTE_API_KEY") || "";
  const base = Deno.env.get("OMNIROUTE_BASE_URL") || "";
  if (!key || !base || !summary.trim()) return fallback;
  try {
    const response = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "VICEHUB Newsroom" },
      body: JSON.stringify({
        model: Deno.env.get("OMNIROUTE_MODEL") || "auto", temperature: 0.2, max_tokens: 1100,
        messages: [
          { role: "system", content: "You are the VICEHUB editorial desk. Write an original, concise GTA VI news brief using ONLY the supplied source material. Do not invent facts, dates, numbers, quotes, context or implications. Attribute claims to the named source. Keep uncertainty explicit. Return JSON only with title (max 160 chars), summary (max 450 chars), body (120-220 words maximum). If the source contains too little information, produce a short factual brief rather than padding. Do not reproduce the source article." },
          { role: "user", content: JSON.stringify({ source: source.name, sourceUrl: articleUrl, headline: title, sourceText: summary }) }
        ]
      })
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const raw = payload.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/^\s*\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60\s*$/,"").trim();
    const result = JSON.parse(clean);
    if (!result.title || !result.summary || !result.body) return fallback;
    return { title: String(result.title).slice(0,180), summary: String(result.summary).slice(0,500), body: String(result.body).slice(0,20000) };
  } catch { return fallback; }
}
async function notifyPublished(entities: any, title: string, service?: any) {
  const dispatchSecret=Deno.env.get("PUSH_DISPATCH_SECRET")||"";
  for (let offset=0; offset<100000; offset+=5000) {
    const users = await entities.User.list("-created_date", 5000, offset);
    if (!users.length) break;
    for (const user of users) await entities.UserNotification.create({
      user_id: user.id, type: "news", title: "New official GTA VI update",
      body: title, target_url: "/news"
    }).catch(() => null);
    if(dispatchSecret&&service?.functions?.invoke){
      for(let start=0;start<users.length;start+=100)await service.functions.invoke("vicehub-send-push",{dispatchSecret,userIds:users.slice(start,start+100).map((user:any)=>user.id),title:"New official GTA VI update",body:title,url:"/news"}).catch(()=>null);
    }
    if (users.length < 5000) break;
  }
}

async function importX(source: any, url: URL, db: any, service?: any) {
  const token = Deno.env.get("X_BEARER_TOKEN") || "";
  if (!token) throw new Error("X_BEARER_TOKEN is missing from Base44 secrets.");
  if (source.last_external_id) url.searchParams.set("since_id", source.last_external_id);
  const response = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (!response.ok) throw new Error("X API returned HTTP " + response.status);
  const payload = await response.json();
  const users = new Map((payload.includes?.users || []).map((u: any) => [u.id, u]));
  const media = new Map((payload.includes?.media || []).map((m: any) => [m.media_key, m]));
  let created = 0;
  for (const tweet of (payload.data || []).slice(0, 20)) {
    const text = String(tweet.text || "").replace(/\s+/g, " ").trim();
    if (!GTA_PATTERN.test(text)) continue;
    const author: any = users.get(tweet.author_id);
    const username = author?.username || "user";
    const articleUrl = "https://x.com/" + username + "/status/" + tweet.id;
    const exists = await db.NewsArticle.filter({ source_url: articleUrl }, "-created_date", 1, 0);
    if (exists.length) continue;
    const title = text.slice(0, 170) || "GTA VI social update";
    const mediaKey = tweet.attachments?.media_keys?.[0];
    const mediaItem: any = mediaKey ? media.get(mediaKey) : null;
    const imageUrl = safeImageUrl(mediaItem?.url || mediaItem?.preview_image_url || "");
    const editorial = await generateEditorial(source,title,text,articleUrl);
    const status = source.source_type === "official" && imageUrl ? "published" : "draft";
    const publishedAt = status === "published" ? new Date().toISOString() : undefined;
    const slug = editorial.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 150) + "-" + crypto.randomUUID().slice(0, 6);
    await db.NewsArticle.create({
      title: editorial.title, slug, summary: editorial.summary, body: editorial.body,
      source_name: "@" + username, source_url: articleUrl, source_type: source.source_type || "social",
      confidence: source.source_type === "official" ? "official" : "reported", locale: "en", status, tags: ["X import"],
      ...(imageUrl ? { image_url: imageUrl, image_alt: "Image attached to the original X post by @" + username } : {}),
      source_published_at: tweet.created_at || new Date().toISOString(), last_verified_at: new Date().toISOString(),
      ...(publishedAt ? { published_at: publishedAt } : {}),
    });
    if (status === "published") await notifyPublished(db,editorial.title,service);
    created++;
  }
  return created;
}
async function importRss(source: any, url: URL, db: any, service?: any) {
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Feed returned HTTP " + response.status);
  const xml = (await response.text()).slice(0, 1500000);
  const items = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 20);
  let created = 0;
  for (const match of items) {
    const block = match[2];
    const title = readTag(block, "title").slice(0, 180);
    const atomLink = block.match(/<(?:[a-z0-9_-]+:)?link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const articleUrl = readTag(block, "link") || atomLink?.[1] || "";
    const summary = (readTag(block, "description") || readTag(block, "summary") || readTag(block, "content")).slice(0, 500);
    const imageUrl = readImage(block);
    const publishedText = readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated");
    const publishedDate = publishedText && Number.isFinite(new Date(publishedText).getTime()) ? new Date(publishedText).toISOString() : new Date().toISOString();
    if (!title || !articleUrl.startsWith("https://") || !GTA_PATTERN.test(title + " " + summary)) continue;
    const exists = await db.NewsArticle.filter({ source_url: articleUrl }, "-created_date", 1, 0);
    if (exists.length) continue;
    const editorial = await generateEditorial(source,title,summary || title,articleUrl);
    const status = source.source_type === "official" ? "published" : "draft";
    const publishedAt = status === "published" ? new Date().toISOString() : undefined;
    const slug = editorial.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 170) + "-" + crypto.randomUUID().slice(0, 6);
    await db.NewsArticle.create({
      title: editorial.title, slug, summary: editorial.summary,
      body: editorial.body, source_name: source.name, source_url: articleUrl,
      source_type: source.source_type || "media",
      confidence: source.source_type === "official" ? "official" : "reported",
      locale: "en", status, tags: ["RSS import"],
      ...(imageUrl ? { image_url: imageUrl, image_alt: "Image supplied by " + source.name } : {}),
      source_published_at: publishedDate, last_verified_at: new Date().toISOString(),
      ...(publishedAt ? { published_at: publishedAt } : {}),
    });
    if (status === "published") await notifyPublished(db,editorial.title);
    created++;
  }
  return created;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const input = await req.json().catch(() => ({}));
    const expected = Deno.env.get("GTA_NEWS_SYNC_CRON_SECRET") || "";
    const supplied = typeof input?.cronSecret === "string" ? input.cronSecret : "";
    const isCron = expected.length >= 32 && safeEqual(supplied, expected);
    const caller = await base44.auth.me().catch(() => null);
    if (!isCron && (!caller || caller.role !== "admin")) return Response.json({ error: "Forbidden" }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const sources = await db.NewsSource.filter({ enabled: true }, "-created_date", 30, 0);
    const results: any[] = [];
    for (const source of sources) {
      try {
        const url = validateSourceUrl(source.feed_url);
        const created = url.hostname === "api.x.com" || url.hostname === "api.twitter.com"
          ? await importX(source, url, db, base44.asServiceRole)
          : await importRss(source, url, db, base44.asServiceRole);
        await db.NewsSource.update(source.id, {
          last_checked_at: new Date().toISOString(),
          last_status: "OK — " + created + " new drafts",
        });
        results.push({ source: source.name, status: "ok", created });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 190);
        await db.NewsSource.update(source.id, {
          last_checked_at: new Date().toISOString(),
          last_status: "ERROR — " + message,
        }).catch(() => null);
        results.push({ source: source.name, status: "error", created: 0, error: message });
      }
    }
    return Response.json({
      success: results.every(x => x.status === "ok"),
      sourcesChecked: results.length,
      draftsCreated: results.reduce((n, x) => n + x.created, 0),
      results,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
