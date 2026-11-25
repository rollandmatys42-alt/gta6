import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";
import { createStorageAssetUrl } from "@/lib/storage-fns";

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
        const sourceUrl = await createStorageAssetUrl({
          entities: db,
          connectionId: asset.storage_connection_id,
          objectKey: asset.storage_key,
          expiresIn: 900,
        });
        return Response.json({
          job: {
            id: job.id,
            type: job.job_type,
            idempotencyKey: job.idempotency_key,
            asset: {
              id: asset.id,
              title: asset.title,
              filename: asset.original_filename,
              mimeType: asset.mime_type,
              sizeBytes: asset.file_size_bytes,
              language: asset.language,
            },
            sourceUrl,
          },
        }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
