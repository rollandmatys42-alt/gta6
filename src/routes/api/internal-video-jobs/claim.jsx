import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";
import { createStorageAssetUrl } from "@/lib/storage-fns";
import { getGoogleDriveAccessToken } from "@/lib/google-drive-api";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/internal-video-jobs/claim")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const expected = secrets.get("VICEHUB_VIDEO_WORKER_TOKEN");
        const supplied = request.headers.get("x-vicehub-worker-token") || "";
        if (!expected || expected.length < 32 || !safeEqual(expected, supplied)) {
          return Response.json({ error: "Worker authentication failed." }, { status: 401, headers: { "cache-control": "no-store" } });
        }
        const workerId = (request.headers.get("x-vicehub-worker-id") || "").trim().slice(0, 128);
        if (!workerId) return Response.json({ error: "Worker ID is required." }, { status: 400 });
        const db = context.getBase44().asServiceRole.entities;
        const queued = await db.InternalVideoJob.filter({ status: "queued" }, "created_date", 1, 0);
        const job = queued[0];
        if (!job) return Response.json({ job: null }, { headers: { "cache-control": "no-store" } });
        const asset = await db.InternalVideoAsset.get(job.asset_id).catch(() => null);
        if (!asset || asset.status === "archived" || !["authorised", "not_applicable"].includes(asset.rights_status)) {
          await db.InternalVideoJob.update(job.id, {
            status: "failed",
            error_code: "SOURCE_NOT_ELIGIBLE",
            error_message: "The source asset is missing, archived or does not have cleared usage rights.",
            stage: "Rejected before processing",
            completed_at: new Date().toISOString(),
          });
          return Response.json({ job: null }, { headers: { "cache-control": "no-store" } });
        }

        let sourceUrl;
        let sourceRequiresWorkerAuth = false;
        let sourceDownloadMode = "stored";
        const isExternalSource = asset.storage_provider === "external_source" && !!asset.source_url;
        const isDriveAsset = asset.storage_provider === "google_drive" || !!asset.google_drive_file_id;
        try {
          if (isExternalSource) {
            sourceUrl = asset.source_url;
            sourceDownloadMode = "extractor";
          } else if (isDriveAsset) {
            if (!asset.google_drive_file_id) throw new Error("Google Drive source ID is missing.");
            sourceUrl = new URL("/api/internal-video-job-source?jobId=" + encodeURIComponent(job.id), request.url).toString();
            sourceRequiresWorkerAuth = true;
            await getGoogleDriveAccessToken(context.getBase44());
          } else {
            sourceUrl = await createStorageAssetUrl({
              entities: db,
              connectionId: asset.storage_connection_id,
              objectKey: asset.storage_key,
              expiresIn: 900,
            });
          }
        } catch {
          return Response.json({ error: "The private source could not be prepared. The job remains queued." }, { status: 503 });
        }
        if (!sourceUrl) return Response.json({ error: "The private source URL is unavailable. The job remains queued." }, { status: 503 });

        if (job.job_type === "cut_clip") {
          try {
            await getGoogleDriveAccessToken(context.getBase44());
          } catch {
            return Response.json({ error: "Google Drive is not connected for clip exports. The job remains queued." }, { status: 503 });
          }
        }
        const now = new Date().toISOString();
        await db.InternalVideoJob.update(job.id, {
          status: "processing",
          progress_percent: 1,
          stage: "Worker accepted job",
          worker_id: workerId,
          attempts: Number(job.attempts || 0) + 1,
          started_at: now,
          lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        await db.InternalVideoAsset.update(asset.id, { status: "processing" });
        return Response.json({
          job: {
            id: job.id,
            type: job.job_type,
            idempotencyKey: job.idempotency_key,
            startSeconds: job.start_seconds,
            endSeconds: job.end_seconds,
            outputTitle: job.output_title,
            outputDriveParentId: job.output_drive_parent_id || asset.google_drive_parent_id || null,
            sourceRequiresWorkerAuth,
            sourceDownloadMode,
            asset: {
              id: asset.id,
              title: asset.title,
              filename: asset.original_filename,
              mimeType: asset.mime_type,
              sizeBytes: asset.file_size_bytes,
              language: asset.language,
              storageProvider: isDriveAsset ? "google_drive" : "s3",
              googleDriveFileId: asset.google_drive_file_id || null,
              sourcePlatform: asset.source_platform || null,
            },
            sourceUrl,
          },
        }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
