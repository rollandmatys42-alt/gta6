# VICEHUB Video Worker

A separate, single-replica container for private video probing, precise clip rendering and optional local speech transcription. It polls the VICEHUB job API; it does not run inside Base44 and does not receive browser traffic.

## Enabled operations

- `analyse`: FFprobe reads duration, width and height.
- `transcribe`: faster-whisper runs locally in this container and returns a timestamped transcript.
- `cut_clip`: FFmpeg renders a selected time range to an MP4 and uploads it to the connected Google Drive account using a resumable upload session.

The clip renderer uses H.264/AAC re-encoding for frame-accurate cuts. It processes one job at a time and is limited to 15 minutes per clip for the initial low-resource VPS profile.

## Storage and privacy

- The original file remains in its source storage provider. For Google Drive assets, Base44 streams the file to the worker through an authenticated, private endpoint.
- Google OAuth tokens never leave Base44. The worker receives only a single-job source stream and a Google Drive resumable upload session URL scoped to one output file.
- Completed clips are saved to the source video's parent folder when available, otherwise to the connected Drive account's root.
- Source and output work files are held in a per-job temporary directory. The directory is removed after the job and abandoned `vicehub-*` work directories are removed after 60 minutes.
- The `/models` volume may cache AI model weights; it must never contain source videos or rendered clips.
- The current Base44 app connector supports one app-wide Google Drive account per application. It is not a multi-account-per-user connection manager. Multi-account Drive OAuth requires a separate implementation and must not be approximated by sharing access tokens.

## Required environment

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `VICEHUB_API_BASE_URL` | Yes | — | Published VICEHUB app base URL, HTTPS only |
| `VICEHUB_VIDEO_WORKER_TOKEN` | Yes | — | Random shared secret stored in Base44 App Secrets and VPS environment; minimum 32 characters |
| `VICEHUB_VIDEO_WORKER_ID` | No | Container hostname | Stable worker identifier |
| `VICEHUB_WORKER_ENABLED` | No | `true` | Set false to run health endpoint without polling |
| `WORKER_POLL_SECONDS` | No | `5` | Queue poll interval |
| `WORKER_DISK_RESERVE_BYTES` | No | 1 GiB | Minimum free temporary disk reserve |
| `VIDEO_TEMP_DIR` | No | `/tmp/vicehub-video` | Temporary source and output directory |
| `WHISPER_MODEL` | No | `small` | faster-whisper model |
| `WHISPER_DEVICE` | No | `cpu` | `cpu` or a supported GPU device |
| `WHISPER_COMPUTE_TYPE` | No | `int8` | CTranslate2 compute type |
| `WHISPER_MODEL_DIR` | No | `/models` | Persistent model cache mount |

## Build

```sh
docker build -t vicehub-video-worker:0.2.0 workers/video-engine
```

## Run

Pass secrets through the container runtime's secret manager, not a committed `.env` file:

```sh
docker run --rm -p 8080:8080 \
  -e VICEHUB_API_BASE_URL=https://gta6-creator-hub-c26cc578.base44.app \
  -e VICEHUB_VIDEO_WORKER_TOKEN="$VICEHUB_VIDEO_WORKER_TOKEN" \
  -v vicehub-model-cache:/models \
  -v vicehub-video-tmp:/tmp/vicehub-video \
  vicehub-video-worker:0.2.0
```

Run exactly one replica and one Uvicorn process. The current Base44 claim endpoint is not a transactional compare-and-swap queue, so multiple pollers could claim the same queued job. Do not scale horizontally until an atomic broker/lock has been added.

## Network and secrets

- Keep the worker token only in Base44 Secrets and the VPS secret environment. Never put it in GitHub, frontend code, logs or job records.
- Restrict worker egress to the VICEHUB HTTPS API and Google Drive resumable upload host. Google OAuth is handled by Base44, not the worker.
- Never log signed source URLs or resumable upload session URLs.
- The worker downloads only a source URL returned by the authenticated VICEHUB claim API; it never downloads arbitrary user-provided URLs.

## Deployment status

The source is not yet deployed. Configure the Base44 secret and VPS environment only after the VPS is confirmed. Before unattended production use, test MP4 and MOV sources, Drive download permissions, clip export, the returned Drive file ID, expired sessions, worker restarts, temporary disk exhaustion and the 60-minute cleanup routine.
