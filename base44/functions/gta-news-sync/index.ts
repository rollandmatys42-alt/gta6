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
  "api.x.com", "api.twitter.com",
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
async function importX(source: any, url: URL, db: any) {
  const token = Deno.env.get("X_BEARER_TOKEN") || "";
  if (!token) throw new Error("X_BEARER_TOKEN is missing from Base44 secrets.");
  const response = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (!response.ok) throw new Error("X API returned HTTP " + response.status);
  const payload = await response.json();
  const users = new Map((payload.includes?.users || []).map((u: any) => [u.id, u]));
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
    const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 150) + "-" + crypto.randomUUID().slice(0, 6);
    await db.NewsArticle.create({
      title, slug, summary: text.slice(0, 500), body: text.slice(0, 2000),
      source_name: "@" + username, source_url: articleUrl, source_type: "social",
      confidence: "reported", locale: "en", status: "draft", tags: ["X import"],
    });
    created++;
  }
  return created;
}
async function importRss(source: any, url: URL, db: any) {
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
    if (!title || !articleUrl.startsWith("https://") || !GTA_PATTERN.test(title + " " + summary)) continue;
    const exists = await db.NewsArticle.filter({ source_url: articleUrl }, "-created_date", 1, 0);
    if (exists.length) continue;
    const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 170) + "-" + crypto.randomUUID().slice(0, 6);
    await db.NewsArticle.create({
      title, slug, summary: summary || "Imported from " + source.name,
      body: summary || title, source_name: source.name, source_url: articleUrl,
      source_type: source.source_type || "media",
      confidence: source.source_type === "official" ? "official" : "reported",
      locale: "en", status: "draft", tags: ["RSS import"],
    });
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
          ? await importX(source, url, db)
          : await importRss(source, url, db);
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
