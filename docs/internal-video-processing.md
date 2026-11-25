# VICEHUB internal video processing — worker contract

## Current scope
The job queue is an internal, administrator-only control plane. Supported jobs:

- `analyse`: probe the source and return duration, width and height.
- `transcribe`: run speech-to-text and return a transcript plus media metadata.
- `cut_clip`: render a selected time interval as an MP4 and export it to the connected Google Drive account.

Clip selection is restricted to a maximum of 15 minutes per job for the initial low-resource worker profile. It uses FFmpeg H.264/AAC re-encoding for accurate start and end times.

## Storage architecture
- Original videos can be imported from Google Drive without copying them into VPS storage.
- Base44 holds the app-scoped Google Drive OAuth token and streams the source to the authenticated worker. The Google token is never sent to the VPS.
- The worker creates a per-job temporary directory, streams the source to disk, and deletes the directory after processing. A janitor removes abandoned `vicehub-*` directories older than 60 minutes.
- Clip export uses a Google Drive resumable upload session initiated server-side by Base44. The worker receives only the session URL for one output file. Base44 verifies the resulting Drive file metadata before creating a clip asset record.
- A clip is saved to the source video's parent folder where available, or the root of the connected Drive account otherwise.
- Only model cache files may persist in `/models`; source and clip media must never be cached there.

## Connector limitation
The installed Base44 service-role connector is app-scoped and exposes one connected Google Drive account per app. It does not provide a multi-account Drive picker. This implementation uses the connected app-wide account. Supporting several separately authenticated Drive accounts requires a separate per-account OAuth implementation; do not copy or share the current connector token to simulate that feature.

## Queue lifecycle
`queued → processing → succeeded | failed`

A queued job can be cancelled by an administrator. A processing job cannot be force-cancelled from the UI; the worker must stop and report a terminal state. Each job has a stable idempotency key, attempt count, progress, stage, worker ID and lease timestamp.

The initial worker deployment must run as **one active worker replica with one claim request at a time**. The Base44 entity API does not expose an atomic compare-and-swap claim primitive through this application contract; horizontally scaling pollers before adding a transactional queue/lock service would risk duplicate claims.

## Worker authentication
Configure the Base44 application secret `VICEHUB_VIDEO_WORKER_TOKEN` only when the worker is deployed. Use a cryptographically random value of at least 32 characters, shared only with the worker.

Worker endpoints:
- `POST /api/internal-video-jobs/claim`: worker claims one queued job.
- `GET /api/internal-video-job-source?jobId=...`: for Drive-backed sources, streams the active job's source after validating the worker token and worker ID.
- `POST /api/internal-video-job-upload`: starts a single-file Drive resumable upload session for an owned `cut_clip` job.
- `POST /api/internal-video-jobs/{jobId}`: progress and terminal callbacks.

The worker must treat source and upload-session URLs as secrets, never log them, and must not fetch arbitrary external URLs supplied by users.

## Rights and safety
The enqueue and claim paths both require `rights_status` to be `authorised` or `not_applicable`. Pending or restricted material cannot be processed. External source URLs remain provenance only; no YouTube download, cookie rotation, CAPTCHA bypass, DRM bypass or access-control circumvention is implemented.

## Operational requirements before production
- Deploy the worker in a separate container runtime with FFmpeg and faster-whisper; Base44 request handlers must not perform media processing.
- Set the shared worker token in Base44 secrets and the worker environment.
- Restrict worker network egress and use HTTPS only.
- Add retry/backoff and stale-lease recovery before unattended production processing.
- Keep concurrency and resource limits based on measured CPU/RAM/disk capacity.
- Run real MP4 and MOV tests for analysis and clip export, verify the Drive file ID and output metadata, test expired resumable sessions, worker restart/lease recovery and temporary-disk exhaustion.
- Keep the worker single-replica until the queue claim is atomic.

## Current implementation location
- `workers/video-engine/worker.py`: sequential FastAPI worker, FFprobe metadata extraction, FFmpeg clip rendering, optional faster-whisper transcription, streaming source download, Google Drive resumable output upload and 60-minute orphan cleanup.
- `src/lib/google-drive-api.js`: Base44-only Google Drive API helper. The app-scoped token never leaves Base44.
