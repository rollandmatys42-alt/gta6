import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

function requireAdmin(context) {
  if (context.user?.role !== "admin") throw Object.assign(new Error("Administrator access required."), { status: 403 });
}
function identifyPlatform(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  
  
  
  
  if (/\.(mp4|m4v|mov|webm|mkv|avi)(\?|$)/i.test(url.pathname + url.search)) return "direct";
  return "unsupported";
}
export const createExternalVideoSource = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    sourceUrl: z.string().trim().url().max(1000),
    title: z.string().trim().max(180).optional().default(""),
    rightsAttested: z.boolean(),
  }))
  .handler(async ({ data, context }) => {
    requireAdmin(context);
    if (!data.rightsAttested) throw Object.assign(new Error("Confirm the usage rights before importing this video."), { status: 400, code: "RIGHTS_ATTESTATION_REQUIRED" });
    const url = new URL(data.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw Object.assign(new Error("Use a public HTTP or HTTPS video URL without embedded credentials."), { status: 400, code: "INVALID_SOURCE_URL" });
    }
    const platform = identifyPlatform(url);
    if (platform !== "direct") throw Object.assign(new Error("Use a direct MP4, MOV or WebM file URL. Platform pages are not processed by VICEHUB."), { status: 415, code: "UNSUPPORTED_VIDEO_SOURCE" });
    const db = context.getBase44().asServiceRole.entities;
    const existing = await db.InternalVideoAsset.filter({ source_url: url.toString() }, "-created_date", 1, 0);
    if (existing.length) return { asset: existing[0], alreadyImported: true, platform };
    const now = new Date().toISOString();
    const asset = await db.InternalVideoAsset.create({
      title: (data.title || "Source vidéo — " + url.hostname).slice(0, 180),
      description: "Vidéo prête à être vérifiée et publiée dans la bibliothèque VICEHUB.",
      asset_type: "source",
      status: "ready",
      category: "",
      language: "und",
      tags: ["New"],
      source_url: url.toString(),
      source_platform: platform,
      rights_status: "pending",
      rights_attested_by: context.user.id,
      rights_attested_at: now,
      storage_provider: "external_source",
      original_filename: url.hostname.slice(0, 180),
      mime_type: url.pathname.toLowerCase().endsWith(".webm") ? "video/webm" : url.pathname.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4",
      preview_url: url.toString(),
      download_url: url.toString(),
      review_status: "needs_review",
      created_by: context.user.id,
    });
    return { asset, alreadyImported: false, platform };
  });
