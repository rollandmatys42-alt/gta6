# VICEHUB Video Worker

A separate, single-replica container for private media probing and local speech transcription. It polls the VICEHUB job API; it does not run inside Base44 and does not receive browser traffic.

## Enabled operations

- `analyse`: FFprobe reads duration, width and height.
- `transcribe`: faster-whisper runs locally in this container and returns a timestamped transcript.

Clip ranking, scene detection, reframing, clip export, S3 output upload and multipart source ingestion are not implemented in this first worker release.

## Required environment

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `VICEHUB_API_BASE_URL` | Yes | — | Published VICEHUB app base URL, HTTPS only |
| `VICEHUB_VIDEO_WORKER_TOKEN` | Yes | — | Same random secret stored as a Base44 app secret; minimum 32 characters |
| `VICEHUB_VIDEO_WORKER_ID` | No | Container hostname | Stable worker identifier |
| `VICEHUB_WORKER_ENABLED` | No | `true` | Set false to run health endpoint without polling |
| `WORKER_POLL_SECONDS` | No | `5` | Queue poll interval |
| `WORKER_DISK_RESERVE_BYTES` | No | 1 GiB | Free disk reserve; not a source-file size cap |
| `VIDEO_TEMP_DIR` | No | `/tmp/vicehub-video` | Temporary source download directory |
| `WHISPER_MODEL` | No | `small` | faster-whisper model |
| `WHISPER_DEVICE` | No | `cpu` | `cpu` or a supported GPU device |
| `WHISPER_COMPUTE_TYPE` | No | `int8` | CTranslate2 compute type |
| `WHISPER_MODEL_DIR` | No | `/models` | Persistent model cache mount |

## Build

```sh
docker build -t vicehub-video-worker:0.1.0 workers/video-engine
```

## Run

Pass secrets through the container runtime's secret manager, not a committed `.env` file:

```sh
docker run --rm -p 8080:8080 \
  -e VICEHUB_API_BASE_URL=https://gta6-creator-hub-c26cc578.base44.app \
  -e VICEHUB_VIDEO_WORKER_TOKEN="$VICEHUB_VIDEO_WORKER_TOKEN" \
  -v vicehub-model-cache:/models \
  -v vicehub-video-tmp:/tmp/vicehub-video \
  vicehub-video-worker:0.1.0
```

Run exactly one replica and one Uvicorn process. The current Base44 claim endpoint is not a transactional compare-and-swap queue, so multiple pollers could claim the same queued job. Do not scale horizontally until an atomic broker/lock has been added.

## Privacy and network

- Source URLs are short-lived signed object URLs issued by VICEHUB. The worker does not download arbitrary user-supplied URLs.
- Source files are streamed to temporary disk, never loaded fully into memory, and the temporary directory is removed after each job.
- Transcription uses faster-whisper locally; audio is not sent to a third-party transcription API.
- The model may be downloaded from its model registry on first use. Pre-populate and persist the model cache if the production network policy must deny that egress.
- Never log the signed source URL or worker token.
- Restrict outbound network to the VICEHUB app, the configured private object-storage host and the model registry required for first-time model download.
- Keep the model cache on persistent storage; use encrypted ephemeral storage for source files.
- Set CPU, RAM, disk and GPU limits according to measured workload. There is no artificial maximum video duration in the application, but the container's real disk and compute capacity still apply.

## Deployment status

This source is ready to build as a container. It is not deployed yet. A container runtime and its secret storage must be selected and configured before the worker can claim jobs. No Base44 Builder, integration credits or VPS shell workflow is required to build this source.
