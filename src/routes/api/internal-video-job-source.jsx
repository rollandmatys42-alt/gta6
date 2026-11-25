import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";
import { streamGoogleDriveMedia } from "@/lib/google-drive-api";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/internal-video-job-source")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const expected = secrets.get("VICEHUB_VIDEO_WORKER_TOKEN");
        const supplied = request.headers.get("x-vicehub-worker-token") || "";
        if (!expected || expected.length < 32 || !safeEqual(expected, supplied)) {
          return Response.json({ error: "Worker authentication failed." }, { status: 401, headers: { "cache-control": "no-store" } });
        }
        const workerId = (request.headers.get("x-vicehub-worker-id") || "").trim();
        const jobId = new URL(request.url).searchParams.get("jobId") || "";
        if (!workerId || !jobId) return Response.json({ error: "Worker ID and job ID are required." }, { status: 400 });
        const db = context.getBase44().asServiceRole.entities;
        const job = await db.InternalVideoJob.get(jobId).catch(() => null);
        if (!job || job.status !== "processing" || job.worker_id !== workerId) {
          return Response.json({ error: "This worker does not own an active job for the requested source." }, { status: 403 });
        }
        const asset = await db.InternalVideoAsset.get(job.asset_id).catch(() => null);
        if (!asset || asset.status === "archived" || !["authorised", "not_applicable"].includes(asset.rights_status) || asset.storage_provider !== "google_drive" || !asset.google_drive_file_id) {
          return Response.json({ error: "The Google Drive source is unavailable." }, { status: 404 });
        }
        try {
          return await streamGoogleDriveMedia(context.getBase44(), asset.google_drive_file_id, request);
        } catch {
          return Response.json({ error: "Google Drive could not stream the private source video." }, { status: 502, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
