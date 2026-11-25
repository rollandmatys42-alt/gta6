import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

function requireAdmin(context) {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403 });
}
function identifyPlatform(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) return "youtube";
  if (host === "dailymotion.com" || host.endsWith(".dailymotion.com") || host === "dai.ly") return "dailymotion";
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return "twitch";
  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
  if (/\.(mp4|m4v|mov|webm|mkv|avi)(\?|$)/i.test(url.pathname + url.search)) return "direct";
  return "other";
}
export const createExternalVideoSource = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    sourceUrl: z.string().trim().url().max(1000),
    title: z.string().trim().max(180).optional().default(""),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    const url = new URL(data.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw Object.assign(new Error("Use a public HTTP or HTTPS video URL without embedded credentials."), { status: 400, code: "INVALID_SOURCE_URL" });
    }
    const platform = identifyPlatform(url);
    const db = context.getBase44().asServiceRole.entities;
    const existing = await db.InternalVideoAsset.filter({ source_url: url.toString() }, "-created_date", 1, 0);
    if (existing.length) return { asset: existing[0], alreadyImported: true, platform };
    const now = new Date().toISOString();
    const asset = await db.InternalVideoAsset.create({
      title: (data.title || "Source vidéo — " + url.hostname).slice(0, 180),
      description: "Source importée dans VICEHUB. Les métadonnées éditoriales seront générées après analyse.",
      asset_type: "source",
      status: "stored",
      category: "",
      language: "und",
      tags: ["New"],
      source_url: url.toString(),
      source_platform: platform,
      rights_status: "authorised",
      rights_attested_by: context.user.id,
      rights_attested_at: now,
      storage_provider: "external_source",
      original_filename: url.hostname.slice(0, 180),
      mime_type: "application/octet-stream",
      review_status: "needs_review",
      created_by: context.user.id,
    });
    return { asset, alreadyImported: false, platform };
  });
