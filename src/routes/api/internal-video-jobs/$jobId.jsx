import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";
import { getGoogleDriveFileMetadata } from "@/lib/google-drive-api";


async function omniRouteChat({messages, maxTokens = 3500, temperature = 0.2}) {
  const key = secrets.get("OMNIROUTE_API_KEY");
  const base = secrets.get("OMNIROUTE_BASE_URL");
  if (!key || !base) throw new Error("OmniRoute is not configured.");
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const response = await fetch(cleanBase + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "VICEHUB clip intelligence" },
    body: JSON.stringify({ model: secrets.get("OMNIROUTE_MODEL") || "auto", messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(90000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "OmniRoute returned HTTP " + response.status);
  const output = payload.choices?.[0]?.message?.content;
  if (!output) throw new Error("OmniRoute returned an empty response.");
  return output;
}

async function generateClipPlan(sourceAsset, transcript, durationSeconds) {
  const prompt = `Analyse cette transcription horodatée pour VICEHUB. Propose entre 3 et 6 extraits courts et autonomes qui ont un vrai potentiel de rétention et de partage. Les timecodes doivent correspondre exactement aux horodatages fournis. Ne fabrique aucun contenu ni aucune statistique. Chaque clip doit durer idéalement 20 à 90 secondes, jamais plus de 180 secondes, et rester dans la durée totale de la vidéo.

Retourne uniquement un objet JSON valide avec cette structure :
{
 "title":"titre descriptif de la source",
 "description":"résumé fidèle",
 "language":"code langue ISO 639-1",
 "languageConfidence":0.0,
 "category":"Gaming, News, Comedy, Sport, Technology, Interview, Education, Other",
 "topic":"sujet précis",
 "targetCountries":["GB","FR"],
 "tags":["tag1","tag2"],
 "viralPotentialScore":0,
 "viralScoreFactors":{"hook":0,"emotion":0,"clarity":0,"shareability":0,"pacing":0},
 "clips":[{"startSeconds":0,"endSeconds":45,"title":"titre spécifique du clip","description":"description fidèle du passage","tags":["tag1"],"viralPotentialScore":0,"hook":"accroche du passage"}]
}
Scores sur 100. Pays = marchés cibles probables, pas pays d'origine. Utilise les codes ISO 3166-1 alpha-2 : GB pour le Royaume-Uni, US pour les États-Unis, CA, FR, BE, LU, etc. La langue doit être celle entendue. Ne confonds jamais langue et marché. Ne crée pas de score de performance réelle : seuls les scores prédictifs sont autorisés.
Titre initial de la source : ${sourceAsset.title || "Source vidéo"}.
Durée : ${durationSeconds} secondes.
Transcription :
${String(transcript || "").slice(0, 60000)}`;
  const raw = await omniRouteChat({ messages: [{ role: "user", content: prompt }] });
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  const plan = JSON.parse(cleaned);
  if (!Array.isArray(plan.clips)) throw new Error("OmniRoute clip plan is missing clips.");
  const clips = plan.clips.slice(0, 6).map((clip) => ({
    startSeconds: Number(clip.startSeconds),
    endSeconds: Number(clip.endSeconds),
    title: String(clip.title || "VICEHUB clip").slice(0, 180),
    description: String(clip.description || "").slice(0, 1500),
    tags: Array.isArray(clip.tags) ? clip.tags.map(x => String(x).slice(0, 50)).slice(0, 20) : [],
    viralPotentialScore: Math.max(0, Math.min(100, Math.round(Number(clip.viralPotentialScore) || 0))),
    hook: String(clip.hook || "").slice(0, 300),
  })).filter(x => Number.isFinite(x.startSeconds) && Number.isFinite(x.endSeconds) && x.startSeconds >= 0 && x.endSeconds > x.startSeconds && x.endSeconds <= durationSeconds && x.endSeconds - x.startSeconds <= 180);
  if (!clips.length) throw new Error("OmniRoute did not return any valid clip timecodes.");
  return {
    title: String(plan.title || sourceAsset.title || "Source vidéo").slice(0, 180),
    description: String(plan.description || "").slice(0, 5000),
    language: String(plan.language || "und").slice(0, 12),
    languageConfidence: Math.max(0, Math.min(1, Number(plan.languageConfidence) || 0)),
    category: String(plan.category || "Other").slice(0, 80),
    topic: String(plan.topic || "").slice(0, 300),
    targetCountries: Array.isArray(plan.targetCountries) ? [...new Set(plan.targetCountries.map(x => String(x).toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x)))].slice(0, 20) : [],
    tags: Array.isArray(plan.tags) ? [...new Set(plan.tags.map(x => String(x).slice(0, 50)))].slice(0, 30) : [],
    viralPotentialScore: Math.max(0, Math.min(100, Math.round(Number(plan.viralPotentialScore) || 0))),
    viralScoreFactors: plan.viralScoreFactors && typeof plan.viralScoreFactors === "object" ? plan.viralScoreFactors : {},
    clips,
  };
}
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

        const sourceAsset = await db.InternalVideoAsset.get(job.asset_id).catch(() => null);
        if (!sourceAsset) return Response.json({ error: "Source asset not found." }, { status: 404 });

        let createdClip = null;
        let verifiedDriveFile = null;
        if (status === "succeeded" && job.job_type === "cut_clip") {
          const driveFileId = String(body.outputDriveFileId || "");
          if (!driveFileId) return Response.json({ error: "A completed clip must include its Google Drive file ID." }, { status: 400 });
          try {
            verifiedDriveFile = await getGoogleDriveFileMetadata(context.getBase44(), driveFileId);
          } catch {
            return Response.json({ error: "The uploaded clip could not be verified in Google Drive. The job remains active for retry." }, { status: 502 });
          }
          const expectedSize = Number(body.outputFileSizeBytes);
          const expectedMd5 = String(body.outputMd5Checksum || "").toLowerCase();
          const actualMd5 = String(verifiedDriveFile.md5Checksum || "").toLowerCase();
          if (
            verifiedDriveFile.mimeType !== "video/mp4" ||
            !Number.isSafeInteger(expectedSize) ||
            expectedSize <= 0 ||
            Number(verifiedDriveFile.size || 0) !== expectedSize ||
            !/^[a-f0-9]{32}$/.test(expectedMd5) ||
            !actualMd5 ||
            actualMd5 !== expectedMd5
          ) {
            return Response.json({ error: "Google Drive clip integrity verification failed (MIME type, size or MD5 checksum mismatch)." }, { status: 422 });
          }
          const existing = await db.InternalVideoAsset.filter({ google_drive_file_id: driveFileId }, "-created_date", 1, 0);
          createdClip = existing[0] || await db.InternalVideoAsset.create({
            title: String(verifiedDriveFile.name || job.output_title || "VICEHUB clip").slice(0, 180),
            description: String(job.output_description || ("Generated by the VICEHUB FFmpeg worker from: " + String(sourceAsset.title || sourceAsset.id))).slice(0, 5000),
            asset_type: "clip",
            status: "ready",
            category: job.output_category || sourceAsset.category || "",
            language: job.output_language || sourceAsset.language || "en",
            tags: Array.isArray(job.output_tags) ? job.output_tags : (Array.isArray(sourceAsset.tags) ? sourceAsset.tags : []),
            ...(job.output_topic ? { topic: job.output_topic } : {}),
            ...(Number.isInteger(job.output_viral_potential_score) ? { viral_potential_score: job.output_viral_potential_score } : {}),
            ...(job.output_viral_score_factors ? { viral_score_factors: job.output_viral_score_factors } : {}),
            review_status: "needs_review",
            rights_status: sourceAsset.rights_status,
            ...(sourceAsset.rights_evidence_url ? { rights_evidence_url: sourceAsset.rights_evidence_url } : {}),
            storage_provider: "google_drive",
            google_drive_file_id: verifiedDriveFile.id,
            ...(Array.isArray(verifiedDriveFile.parents) && verifiedDriveFile.parents[0] ? { google_drive_parent_id: verifiedDriveFile.parents[0] } : {}),
            ...(verifiedDriveFile.webViewLink ? { google_drive_web_view_link: verifiedDriveFile.webViewLink } : {}),
            original_filename: String(verifiedDriveFile.name || job.output_title || "VICEHUB-clip.mp4").slice(0, 180),
            mime_type: "video/mp4",
            file_size_bytes: Number(verifiedDriveFile.size || 0),
            duration_seconds: Number.isInteger(body.outputDurationSeconds) && body.outputDurationSeconds >= 0
              ? body.outputDurationSeconds : Math.max(0, Math.round(Number(job.end_seconds) - Number(job.start_seconds))),
            ...(Number.isInteger(body.outputWidth) && body.outputWidth > 0 ? { width: body.outputWidth } : {}),
            ...(Number.isInteger(body.outputHeight) && body.outputHeight > 0 ? { height: body.outputHeight } : {}),
            parent_asset_id: sourceAsset.id,
            created_by: job.created_by || sourceAsset.created_by,
          });
        }

        const patch = {
          status,
          progress_percent: status === "succeeded" ? 100 : progress,
          stage: String(body.stage || status).slice(0, 120),
          lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
        if (body.errorCode) patch.error_code = String(body.errorCode).slice(0, 100);
        if (body.errorMessage) patch.error_message = String(body.errorMessage).slice(0, 1000);
        if (body.resultSummary) patch.result_summary = String(body.resultSummary).slice(0, 5000);
        if (createdClip) patch.output_drive_file_id = createdClip.google_drive_file_id;
        if (status === "succeeded" || status === "failed") patch.completed_at = new Date().toISOString();

        const updated = await db.InternalVideoJob.update(job.id, patch);
        let pipeline = null;
        if (status === "succeeded" || status === "failed") {
          if (status === "succeeded") {
            const assetPatch = { status: "ready" };
            if (typeof body.transcript === "string") assetPatch.transcript = body.transcript.slice(0, 200000);
            if (Number.isInteger(body.durationSeconds) && body.durationSeconds >= 0) assetPatch.duration_seconds = body.durationSeconds;
            if (Number.isInteger(body.width) && body.width > 0) assetPatch.width = body.width;
            if (Number.isInteger(body.height) && body.height > 0) assetPatch.height = body.height;
            await db.InternalVideoAsset.update(sourceAsset.id, assetPatch);

            if (job.job_type === "analyse") {
              const activeTranscription = await db.InternalVideoJob.filter({ asset_id: sourceAsset.id, job_type: "transcribe" }, "-created_date", 10, 0);
              if (!activeTranscription.some(item => ["queued", "processing", "succeeded"].includes(item.status))) {
                const nextJob = await db.InternalVideoJob.create({
                  asset_id: sourceAsset.id, job_type: "transcribe", status: "queued",
                  progress_percent: 0, stage: "Waiting for automatic transcription",
                  attempts: 0, idempotency_key: crypto.randomUUID(), created_by: job.created_by || sourceAsset.created_by,
                });
                await db.InternalVideoAsset.update(sourceAsset.id, { status: "processing" });
                pipeline = { next: "transcribe", jobId: nextJob.id };
              }
            }

            if (job.job_type === "transcribe" && typeof body.transcript === "string") {
              try {
                const plan = await generateClipPlan(sourceAsset, body.transcript, Number(body.durationSeconds || sourceAsset.duration_seconds || 0));
                await db.InternalVideoAsset.update(sourceAsset.id, {
                  title: plan.title, description: plan.description, language: plan.language,
                  detected_language: plan.language, language_confidence: plan.languageConfidence,
                  category: plan.category, topic: plan.topic, target_countries: plan.targetCountries,
                  tags: plan.tags, viral_potential_score: plan.viralPotentialScore,
                  viral_score_factors: plan.viralScoreFactors, review_status: "needs_review",
                });
                const queued = [];
                for (const clip of plan.clips) {
                  const nextJob = await db.InternalVideoJob.create({
                    asset_id: sourceAsset.id, job_type: "cut_clip", status: "queued",
                    progress_percent: 0, stage: "Waiting for automatic clip rendering",
                    attempts: 0, idempotency_key: crypto.randomUUID(),
                    start_seconds: clip.startSeconds, end_seconds: clip.endSeconds,
                    output_title: clip.title, output_description: clip.description,
                    output_tags: clip.tags, output_category: plan.category,
                    output_language: plan.language, output_topic: plan.topic,
                    output_viral_potential_score: clip.viralPotentialScore,
                    output_viral_score_factors: { hook: clip.hook, ...plan.viralScoreFactors },
                    created_by: job.created_by || sourceAsset.created_by,
                  });
                  queued.push(nextJob.id);
                }
                pipeline = { next: "cut_clips", count: queued.length, jobIds: queued };
              } catch (error) {
                log.error("Automatic clip intelligence failed for asset %s: %s", sourceAsset.id, error?.message || error);
                pipeline = { next: "manual_review", reason: "OmniRoute metadata generation unavailable or returned invalid clip timecodes." };
              }
            }
          } else {
            await db.InternalVideoAsset.update(sourceAsset.id, { status: "stored" });
          }
        }
        return Response.json({
          ok: true,
          job: updated,
          ...(pipeline ? { pipeline } : {}),
          ...(createdClip ? { clipAssetId: createdClip.id, driveFileId: createdClip.google_drive_file_id } : {}),
        }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
