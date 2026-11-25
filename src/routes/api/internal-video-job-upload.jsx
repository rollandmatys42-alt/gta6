import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";
import { createGoogleDriveResumableUpload } from "@/lib/google-drive-api";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/internal-video-job-upload")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const expected = secrets.get("VICEHUB_VIDEO_WORKER_TOKEN");
        const supplied = request.headers.get("x-vicehub-worker-token") || "";
        if (!expected || expected.length < 32 || !safeEqual(expected, supplied)) {
          return Response.json({ error: "Worker authentication failed." }, { status: 401, headers: { "cache-control": "no-store" } });
        }
        const workerId = (request.headers.get("x-vicehub-worker-id") || "").trim();
        let body;
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
        const jobId = String(body.jobId || "");
        if (!workerId || !jobId) return Response.json({ error: "Worker ID and job ID are required." }, { status: 400 });
        const db = context.getBase44().asServiceRole.entities;
        const job = await db.InternalVideoJob.get(jobId).catch(() => null);
        if (!job || job.job_type !== "cut_clip" || job.status !== "processing" || job.worker_id !== workerId) {
          return Response.json({ error: "This worker does not own an active clip export job." }, { status: 403 });
        }
        const asset = await db.InternalVideoAsset.get(job.asset_id).catch(() => null);
        if (!asset || asset.status === "archived" || !["authorised", "not_applicable"].includes(asset.rights_status)) {
          return Response.json({ error: "The source asset is not eligible for export." }, { status: 409 });
        }
        if (body.mimeType !== "video/mp4") return Response.json({ error: "Only MP4 clip exports are supported." }, { status: 415 });
        try {
          const upload = await createGoogleDriveResumableUpload(context.getBase44(), {
            fileName: body.fileName,
            fileSizeBytes: body.fileSizeBytes,
            parentFolderId: job.output_drive_parent_id || asset.google_drive_parent_id || null,
          });
          return Response.json({ uploadUrl: upload.uploadUrl }, {
            headers: { "cache-control": "no-store", "pragma": "no-cache" },
          });
        } catch (error) {
          return Response.json({ error: error?.message || "Google Drive upload could not be initiated." }, {
            status: error?.status || 502,
            headers: { "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
