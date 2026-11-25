# VICEHUB internal video processing — worker contract

## Current scope

The job queue is an internal, administrator-only control plane. It is separate from the public video catalogue. The first supported job types are:

- `analyse`: probe the source and return duration, width and height.
- `transcribe`: run speech-to-text and return a transcript plus media metadata.

Clip selection, scene ranking, reframing and FFmpeg rendering are not exposed as enabled jobs until their worker implementations and tests are merged.

## Queue lifecycle

`queued → processing → succeeded | failed`

A queued job can be cancelled by an administrator. A processing job cannot be force-cancelled from the UI; the worker must stop and report a terminal state. Each job has a stable idempotency key, attempt count, progress, stage, worker ID and lease timestamp.

The initial worker deployment must run as **one active worker replica with one claim request at a time**. The Base44 entity API does not expose an atomic compare-and-swap claim primitive through this application contract; horizontally scaling pollers before adding a transactional queue/lock service would risk duplicate claims. Scale-out is deliberately disabled until a proper atomic broker is introduced.

## Worker authentication

Configure the following Base44 application secrets only when the worker service is deployed:

- `VICEHUB_VIDEO_WORKER_TOKEN`: random secret of at least 32 characters, shared only with the worker.
- Never expose this token to the browser, logs, GitHub or job records.

Worker endpoints:

- `POST /api/internal-video-jobs/claim`
  - Headers: `x-vicehub-worker-token`, `x-vicehub-worker-id`
  - Returns `{ job: null }` when the queue is empty.
  - Otherwise returns one job, its type, idempotency key, source metadata and a 15-minute signed private source URL.
- `POST /api/internal-video-jobs/{jobId}`
  - Same headers.
  - JSON body: `status` (`processing`, `succeeded`, `failed`), `progressPercent` (0–100 integer), `stage`, and optional `transcript`, `durationSeconds`, `width`, `height`, `resultSummary`, `errorCode`, `errorMessage`.
  - The worker ID must match the ID recorded when the job was claimed.

The worker must treat the source URL as a short-lived secret, never log it, and must not fetch arbitrary external URLs supplied by users. The source is a private object URL signed by VICEHUB.

## Rights and safety

The enqueue and claim paths both require `rights_status` to be `authorised` or `not_applicable`. Pending or restricted material cannot be processed. External source URLs remain provenance only; no YouTube download, cookie rotation, CAPTCHA bypass, DRM bypass or access-control circumvention is implemented.

## OpenShorts integration boundary

The VICEHUB worker will use only audited, self-hostable core components. Exclude the OpenShorts `cloud/` directory. Before importing individual modules, review their licence and dependency tree. In particular, do not ship Ultralytics/YOLOv8 under AGPL-3.0 in a closed-source commercial VICEHUB deployment without a deliberate compliance decision; replace it or obtain the appropriate licence. FFmpeg build configuration and codec patent/licensing exposure must be checked for the deployment jurisdiction and use case.

## Operational requirements before production

- Deploy the worker in a separate container runtime with FFmpeg and faster-whisper; Base44 request handlers must not perform media processing.
- Set the shared worker token in Base44 secrets and the worker environment.
- Restrict worker network egress and use HTTPS only.
- Add retry/backoff and stale-lease recovery before enabling unattended production processing.
- Add multipart S3 uploads and signed output uploads before enabling clip rendering.
- Keep concurrency and resource limits based on measured CPU/GPU/RAM capacity, not arbitrary product quotas.
