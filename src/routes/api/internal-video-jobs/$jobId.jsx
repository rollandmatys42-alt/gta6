import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/internal-video-jobs/$jobId")({
  server: {
    handlers: {
      POST: async ({ params, request, context }) => {
        const expected = secrets.get("VICEHUB_VIDEO_WORKER_TOKEN");
        const supplied = request.headers.get("x-vicehub-worker-token") || "";
        if (!expected || expected.length < 32 || !safeEqual(expected, supplied)) {
          return Response.json({ error: "Worker authentication failed." }, { status: 401, headers: { "cache-control": "no-store" } });
        }
        let body;
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
        const progress = Number(body.progressPercent ?? 0);
        if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
          return Response.json({ error: "progressPercent must be an integer between 0 and 100." }, { status: 400 });
        }
        const status = body.status;
        if (!["processing", "succeeded", "failed"].includes(status)) {
          return Response.json({ error: "Unsupported job status." }, { status: 400 });
        }
        const db = context.getBase44().asServiceRole.entities;
        const job = await db.InternalVideoJob.get(params.jobId).catch(() => null);
        if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          return Response.json({ error: "Job is already terminal." }, { status: 409 });
        }
        const workerId = request.headers.get("x-vicehub-worker-id") || "";
        if (!workerId || workerId !== job.worker_id) return Response.json({ error: "Worker does not own this job." }, { status: 403 });
        const patch = {
          status,
          progress_percent: status === "succeeded" ? 100 : progress,
          stage: String(body.stage || status).slice(0, 120),
          lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
        if (body.errorCode) patch.error_code = String(body.errorCode).slice(0, 100);
        if (body.errorMessage) patch.error_message = String(body.errorMessage).slice(0, 1000);
        if (body.resultSummary) patch.result_summary = String(body.resultSummary).slice(0, 5000);
        if (status === "succeeded" || status === "failed") {
          patch.completed_at = new Date().toISOString();

        }
        const updated = await db.InternalVideoJob.update(job.id, patch);
        if (status === "succeeded" || status === "failed") {
          const asset = await db.InternalVideoAsset.get(job.asset_id).catch(() => null);
          if (asset && asset.status !== "archived") {
            if (status === "succeeded") {
              const assetPatch = { status: "ready" };
              if (typeof body.transcript === "string") assetPatch.transcript = body.transcript.slice(0, 200000);
              if (Number.isInteger(body.durationSeconds) && body.durationSeconds >= 0) assetPatch.duration_seconds = body.durationSeconds;
              if (Number.isInteger(body.width) && body.width > 0) assetPatch.width = body.width;
              if (Number.isInteger(body.height) && body.height > 0) assetPatch.height = body.height;
              await db.InternalVideoAsset.update(asset.id, assetPatch);
            } else {
              await db.InternalVideoAsset.update(asset.id, { status: "stored" });
            }
          }
        }
        return Response.json({ ok: true, job: updated }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
