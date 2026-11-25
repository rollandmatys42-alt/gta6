import asyncio
import hashlib
import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("vicehub-video-worker")

MAX_TRANSCRIPT_CHARS = 200_000
MAX_CLIP_SECONDS = 900
MODEL = None


def timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def probe_media(path: Path) -> dict:
    command = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,width,height",
        "-of", "json", str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=True)
    metadata = json.loads(result.stdout or "{}")
    video = next((stream for stream in metadata.get("streams", []) if stream.get("codec_type") == "video"), {})
    duration = float((metadata.get("format") or {}).get("duration") or 0)
    return {
        "durationSeconds": max(0, round(duration)),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
    }


def build_clip_command(source: Path, output: Path, start_seconds: float, end_seconds: float) -> list[str]:
    start = float(start_seconds)
    end = float(end_seconds)
    if start < 0 or end <= start or end - start > MAX_CLIP_SECONDS:
        raise ValueError("Invalid clip range.")
    duration = end - start
    return [
        "ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-threads", "2",
        "-movflags", "+faststart", str(output),
    ]



def build_preview_command(source: Path, output: Path, start_seconds: float, duration_seconds: float) -> list[str]:
    duration = max(1.0, min(20.0, float(duration_seconds)))
    start = max(0.0, float(start_seconds))
    watermark = (
        "scale='min(640,iw)':-2,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:"
        "text='VICEHUB PREVIEW':fontcolor=white:fontsize=20:"
        "box=1:boxcolor=black@0.60:boxborderw=10:x=20:y=h-th-20"
    )
    return [
        "ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
        "-map", "0:v:0", "-map", "0:a?",
        "-vf", watermark,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "31",
        "-c:a", "aac", "-b:a", "96k", "-threads", "2",
        "-movflags", "+faststart", str(output),
    ]

def cleanup_stale_workdirs(root: Path, max_age_seconds: int = 3600) -> int:
    root.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - max_age_seconds
    removed = 0
    for candidate in root.iterdir():
        try:
            if not candidate.is_dir() or not candidate.name.startswith("vicehub-"):
                continue
            marker = candidate / ".vicehub-active"
            last_activity = marker.stat().st_mtime if marker.is_file() else candidate.stat().st_mtime
            if last_activity < cutoff:
                shutil.rmtree(candidate, ignore_errors=True)
                removed += 1
        except OSError:
            log.warning("Could not inspect stale temporary path %s.", candidate.name)
    return removed


async def janitor_loop(root: Path) -> None:
    while True:
        try:
            removed = cleanup_stale_workdirs(root, 3600)
            if removed:
                log.info("Removed %s abandoned temporary job directories.", removed)
        except Exception:
            log.exception("Temporary-file janitor failed.")
        await asyncio.sleep(300)


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def transcribe_media(path: Path, language: str | None) -> tuple[str, str | None]:
    global MODEL
    from faster_whisper import WhisperModel

    if MODEL is None:
        model_size = os.getenv("WHISPER_MODEL", "small")
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
        model_dir = os.getenv("WHISPER_MODEL_DIR", "/models")
        MODEL = WhisperModel(model_size, device=device, compute_type=compute_type, download_root=model_dir)

    selected_language = language if language and language not in {"und", "auto"} else None
    segments, info = MODEL.transcribe(
        str(path),
        language=selected_language,
        task="transcribe",
        beam_size=5,
        vad_filter=True,
    )
    lines: list[str] = []
    length = 0
    for segment in segments:
        line = f"[{timestamp(segment.start)} - {timestamp(segment.end)}] {segment.text.strip()}"
        if not line.strip():
            continue
        remaining = MAX_TRANSCRIPT_CHARS - length
        if remaining <= 0:
            break
        line = line[:remaining]
        lines.append(line)
        length += len(line) + 1
        if length >= MAX_TRANSCRIPT_CHARS:
            break
    return "\n".join(lines), getattr(info, "language", None)


class VideoWorker:
    def __init__(self) -> None:
        self.base_url = os.getenv("VICEHUB_API_BASE_URL", "").rstrip("/")
        self.token = os.getenv("VICEHUB_VIDEO_WORKER_TOKEN", "")
        self.worker_id = os.getenv("VICEHUB_VIDEO_WORKER_ID", socket.gethostname())[:128]
        self.poll_seconds = max(2, int(os.getenv("WORKER_POLL_SECONDS", "5")))
        self.disk_reserve = max(0, int(os.getenv("WORKER_DISK_RESERVE_BYTES", str(1024**3))))
        self.temp_root = Path(os.getenv("VIDEO_TEMP_DIR", "/tmp/vicehub-video"))
        self.model_dir = Path(os.getenv("WHISPER_MODEL_DIR", "/models"))
        self.client: httpx.AsyncClient | None = None
        self.active_workdir: Path | None = None
        self.current_progress = 1

    def validate(self) -> None:
        if not self.base_url.startswith("https://"):
            raise RuntimeError("VICEHUB_API_BASE_URL must be an HTTPS URL.")
        if len(self.token) < 32:
            raise RuntimeError("VICEHUB_VIDEO_WORKER_TOKEN must contain at least 32 characters.")
        if not self.worker_id:
            raise RuntimeError("VICEHUB_VIDEO_WORKER_ID cannot be empty.")
        self.temp_root.mkdir(parents=True, exist_ok=True)
        self.model_dir.mkdir(parents=True, exist_ok=True)

    def headers(self) -> dict[str, str]:
        return {
            "x-vicehub-worker-token": self.token,
            "x-vicehub-worker-id": self.worker_id,
            "content-type": "application/json",
        }

    async def start(self) -> None:
        self.validate()
        removed = cleanup_stale_workdirs(self.temp_root, 3600)
        if removed:
            log.info("Removed %s abandoned temporary job directories.", removed)
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), follow_redirects=False)
        log.info("Worker started; one sequential polling loop is active.")

    async def close(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    async def request_json(self, method: str, path: str, **kwargs) -> dict:
        if not self.client:
            raise RuntimeError("Worker HTTP client is not running.")
        response = await self.client.request(
            method,
            self.base_url + path,
            headers=self.headers(),
            **kwargs,
        )
        response.raise_for_status()
        return response.json()

    async def claim(self) -> dict | None:
        payload = await self.request_json("POST", "/api/internal-video-jobs/claim", json={})
        return payload.get("job")

    async def callback(self, job_id: str, payload: dict) -> dict:
        return await self.request_json("POST", f"/api/internal-video-jobs/{job_id}", json=payload)

    async def progress(self, job_id: str, percent: int, stage: str) -> None:
        # Progress must be monotonic: heartbeats must never move a job backwards.
        self.current_progress = max(self.current_progress, max(1, min(99, percent)))
        await self.callback(job_id, {
            "status": "processing",
            "progressPercent": self.current_progress,
            "stage": stage,
        })

    async def download_source(self, source_url: str, target: Path, worker_auth: bool = False) -> None:
        parsed = urlparse(source_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise RuntimeError("The worker received an invalid private source URL.")
        if not self.client:
            raise RuntimeError("Worker HTTP client is not running.")
        headers = None
        if worker_auth:
            expected_host = urlparse(self.base_url).hostname
            if parsed.hostname != expected_host:
                raise RuntimeError("The authenticated source stream must come from the configured VICEHUB host.")
            headers = {
                "x-vicehub-worker-token": self.token,
                "x-vicehub-worker-id": self.worker_id,
            }

        async with self.client.stream("GET", source_url, headers=headers, timeout=None) as response:
            response.raise_for_status()
            content_length = int(response.headers.get("content-length") or 0)
            free = shutil.disk_usage(self.temp_root).free
            if content_length and content_length + self.disk_reserve > free:
                raise RuntimeError("Insufficient temporary disk space for this source video.")
            with target.open("wb") as output:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    if shutil.disk_usage(self.temp_root).free - len(chunk) < self.disk_reserve:
                        raise RuntimeError("Temporary disk reserve reached while downloading the source video.")
                    output.write(chunk)

    async def download_external_source(self, source_url: str, target: Path) -> None:
        parsed = urlparse(source_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise RuntimeError("The external source URL is invalid.")
        host = parsed.hostname.lower().rstrip(".")
        if host in {"localhost", "metadata.google.internal"} or host.endswith(".local"):
            raise RuntimeError("Private or local network source URLs are not accepted.")
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
            if not addresses or any(not ipaddress.ip_address(value).is_global for value in addresses):
                raise RuntimeError("The source hostname resolves to a private or non-public address.")
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError("The source hostname could not be resolved safely.") from exc

        output_template = str(target.with_name("external-source.%(ext)s"))
        command = [
            "python", "-m", "yt_dlp", "--no-playlist", "--no-warnings",
            "--no-progress", "--format", "bestvideo*+bestaudio/best",
            "--merge-output-format", "mp4", "--output", output_template,
            "--max-filesize", "8G", source_url,
        ]
        try:
            await asyncio.to_thread(
                subprocess.run, command, capture_output=True, text=True,
                timeout=10800, check=True,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Source extraction exceeded the three-hour processing limit.") from exc
        candidates = [
            path for path in target.parent.glob("external-source.*")
            if path.is_file() and not path.name.endswith((".part", ".ytdl"))
        ]
        if not candidates:
            raise RuntimeError("The platform connector did not produce a video file.")
        selected = max(candidates, key=lambda path: path.stat().st_size)
        if selected.stat().st_size <= 0:
            raise RuntimeError("The platform connector produced an empty video file.")
        if shutil.disk_usage(self.temp_root).free < self.disk_reserve:
            raise RuntimeError("Temporary disk reserve reached after source extraction.")
        selected.replace(target)

    async def upload_clip_to_drive(self, job_id: str, clip_path: Path, file_name: str) -> dict:
        if not self.client:
            raise RuntimeError("Worker HTTP client is not running.")
        size = clip_path.stat().st_size
        if size <= 0:
            raise RuntimeError("Cannot upload an empty clip.")
        local_md5 = await asyncio.to_thread(md5_file, clip_path)
        session = await self.request_json("POST", "/api/internal-video-job-upload", json={
            "jobId": job_id,
            "fileName": file_name,
            "fileSizeBytes": size,
            "mimeType": "video/mp4",
        })
        upload_url = str(session.get("uploadUrl") or "")
        parsed = urlparse(upload_url)
        if parsed.scheme != "https" or not parsed.hostname or not (
            parsed.hostname == "www.googleapis.com" or parsed.hostname.endswith(".googleapis.com")
        ) or not parsed.path.startswith("/upload/drive/v3/files"):
            raise RuntimeError("The upload endpoint returned an invalid Google Drive session URL.")

        chunk_size = 8 * 1024 * 1024  # multiple of Google's 256 KiB resumable-upload granularity
        offset = 0
        stalled = 0
        result = None
        with clip_path.open("rb") as handle:
            while offset < size:
                handle.seek(offset)
                chunk = await asyncio.to_thread(handle.read, min(chunk_size, size - offset))
                if not chunk:
                    raise RuntimeError("The clip file ended before the declared upload size.")
                end = offset + len(chunk) - 1
                response = await self.client.put(
                    upload_url,
                    content=chunk,
                    headers={
                        "Content-Type": "video/mp4",
                        "Content-Length": str(len(chunk)),
                        "Content-Range": f"bytes {offset}-{end}/{size}",
                    },
                    timeout=None,
                )
                if response.status_code in (200, 201):
                    result = response.json()
                    offset = size
                    break
                if response.status_code == 308:
                    accepted = response.headers.get("Range", "")
                    match = re.search(r"bytes=0-(\d+)", accepted)
                    next_offset = int(match.group(1)) + 1 if match else 0
                    if next_offset <= offset:
                        stalled += 1
                        if stalled >= 3:
                            raise RuntimeError("Google Drive did not acknowledge progress on the resumable clip upload.")
                    else:
                        stalled = 0
                        offset = next_offset
                    await self.progress(job_id, 80 + int((offset / size) * 12), "Uploading clip to Google Drive")
                    continue
                response.raise_for_status()
                raise RuntimeError("Google Drive returned an unexpected resumable-upload response.")
        if not result or not result.get("id"):
            raise RuntimeError("Google Drive did not confirm the uploaded clip file ID.")
        remote_md5 = str(result.get("md5Checksum") or "").lower()
        if remote_md5 and remote_md5 != local_md5:
            raise RuntimeError("Google Drive checksum does not match the locally rendered clip.")
        return {**result, "verifiedMd5Checksum": local_md5, "verifiedSizeBytes": size}

    async def heartbeat(self, job_id: str) -> None:
        while True:
            await asyncio.sleep(90)
            try:
                if self.active_workdir and self.active_workdir.exists():
                    (self.active_workdir / ".vicehub-active").touch()
                await self.progress(job_id, 45, "Worker heartbeat — job is still processing")
            except Exception:
                log.warning("Heartbeat could not be delivered for job %s.", job_id)

    async def process(self, job: dict) -> None:
        job_id = str(job.get("id") or "")
        job_type = job.get("type")
        asset = job.get("asset") or {}
        source_url = job.get("sourceUrl") or ""
        if not job_id or job_type not in {"analyse", "transcribe", "cut_clip"}:
            raise RuntimeError("The queue returned an unsupported job payload.")

        heartbeat_task = asyncio.create_task(self.heartbeat(job_id))
        try:
            suffix = ".mov" if str(asset.get("mimeType", "")).lower() == "video/quicktime" else ".mp4"
            with tempfile.TemporaryDirectory(prefix="vicehub-", dir=self.temp_root) as work_dir:
                self.active_workdir = Path(work_dir)
                (self.active_workdir / ".vicehub-active").touch()
                source_path = Path(work_dir) / ("source" + suffix)
                self.current_progress = 1
                await self.progress(job_id, 5, "Downloading source video to temporary worker storage")
                if job.get("sourceDownloadMode") == "extractor":
                    await self.download_external_source(source_url, source_path)
                else:
                    await self.download_source(source_url, source_path, worker_auth=bool(job.get("sourceRequiresWorkerAuth")))

                await self.progress(job_id, 20, "Reading media streams with FFprobe")
                metadata = await asyncio.to_thread(probe_media, source_path)

                result = {
                    "status": "succeeded",
                    "progressPercent": 100,
                    "stage": "Media analysis complete" if job_type == "analyse" else "Processing complete",
                    **metadata,
                }
                if job_type == "transcribe":
                    await self.progress(job_id, 35, "Loading local faster-whisper model")
                    language = str(asset.get("language") or "und")
                    await self.progress(job_id, 40, "Transcribing audio locally")
                    transcript, detected_language = await asyncio.to_thread(transcribe_media, source_path, language)
                    result["transcript"] = transcript
                    result["resultSummary"] = (
                        f"Local transcription completed; detected language: {detected_language or 'unknown'}."
                    )
                    result["stage"] = "Transcription complete"
                elif job_type == "cut_clip":
                    start = float(job.get("startSeconds"))
                    end = float(job.get("endSeconds"))
                    if end <= start or end - start > MAX_CLIP_SECONDS:
                        raise RuntimeError("The clip range is invalid or exceeds the worker's 15-minute limit.")
                    output_path = Path(work_dir) / "vicehub-clip.mp4"
                    command = build_clip_command(source_path, output_path, start, end)
                    await self.progress(job_id, 35, "FFmpeg is rendering the selected clip")
                    timeout_seconds = max(300, min(7200, int((end - start) * 8)))
                    await asyncio.to_thread(
                        subprocess.run,
                        command,
                        capture_output=True,
                        text=True,
                        timeout=timeout_seconds,
                        check=True,
                    )
                    if not output_path.is_file() or output_path.stat().st_size <= 0:
                        raise RuntimeError("FFmpeg produced an empty clip.")
                    if shutil.disk_usage(self.temp_root).free < self.disk_reserve:
                        raise RuntimeError("Temporary disk reserve reached after clip rendering.")
                    clip_metadata = await asyncio.to_thread(probe_media, output_path)
                    requested_name = str(job.get("outputTitle") or (asset.get("title") or "VICEHUB") + " - clip")
                    safe_name = re.sub(r"[^a-zA-Z0-9._ -]+", "_", requested_name).strip(" ._")[:150] or "VICEHUB-clip"
                    if not safe_name.lower().endswith(".mp4"):
                        safe_name += ".mp4"

                    preview_path = Path(work_dir) / "vicehub-preview.mp4"
                    preview_duration = min(20.0, end - start)
                    preview_command = build_preview_command(source_path, preview_path, start, preview_duration)
                    await self.progress(job_id, 65, "Rendering a short watermarked preview")
                    await asyncio.to_thread(
                        subprocess.run, preview_command, capture_output=True, text=True,
                        timeout=600, check=True,
                    )
                    if not preview_path.is_file() or preview_path.stat().st_size <= 0:
                        raise RuntimeError("FFmpeg produced an empty watermarked preview.")
                    preview_name = safe_name[:-4] + "-preview.mp4"
                    preview_drive_file = await self.upload_clip_to_drive(job_id, preview_path, preview_name)

                    await self.progress(job_id, 93, "Uploading the finished MP4 to the selected Google Drive folder")
                    drive_file = await self.upload_clip_to_drive(job_id, output_path, safe_name)
                    result.update({
                        "stage": "Clip and preview uploaded to Google Drive",
                        "resultSummary": f"FFmpeg clip exported from {start:.2f}s to {end:.2f}s; a 20-second watermarked preview and the full clip were verified in Google Drive.",
                        "outputDriveFileId": str(drive_file["id"]),
                        "outputFileSizeBytes": int(drive_file["verifiedSizeBytes"]),
                        "outputMd5Checksum": drive_file["verifiedMd5Checksum"],
                        "previewDriveFileId": str(preview_drive_file["id"]),
                        "previewFileSizeBytes": int(preview_drive_file["verifiedSizeBytes"]),
                        "previewMd5Checksum": preview_drive_file["verifiedMd5Checksum"],
                        "outputDurationSeconds": clip_metadata["durationSeconds"],
                        "outputWidth": clip_metadata["width"],
                        "outputHeight": clip_metadata["height"],
                    })
                else:
                    result["resultSummary"] = (
                        f"Media probe complete: {metadata['durationSeconds']} seconds, "
                        f"{metadata['width']}×{metadata['height']}."
                    )
                await self.callback(job_id, result)
                log.info("Completed %s job %s.", job_type, job_id)
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            self.active_workdir = None
            self.current_progress = 1

    async def run(self) -> None:
        backoff = self.poll_seconds
        while True:
            try:
                job = await self.claim()
                backoff = self.poll_seconds
                if not job:
                    await asyncio.sleep(self.poll_seconds)
                    continue
                job_id = str(job.get("id") or "unknown")
                try:
                    await self.process(job)
                except Exception:
                    log.exception("Video job %s failed.", job_id)
                    try:
                        await self.callback(job_id, {
                            "status": "failed",
                            "progressPercent": 0,
                            "stage": "Worker reported an error",
                            "errorCode": "VIDEO_WORKER_FAILED",
                            "errorMessage": "The worker could not complete this processing job. Check worker diagnostics.",
                        })
                    except Exception:
                        log.exception("Could not report failure for job %s.", job_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Worker poll failed; backing off.")
                await asyncio.sleep(backoff)
                backoff = min(60, max(self.poll_seconds, backoff * 2))


worker: VideoWorker | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker
    enabled = os.getenv("VICEHUB_WORKER_ENABLED", "true").lower() not in {"0", "false", "no"}
    temp_root = Path(os.getenv("VIDEO_TEMP_DIR", "/tmp/vicehub-video"))
    removed = cleanup_stale_workdirs(temp_root, 3600)
    if removed:
        log.info("Removed %s abandoned temporary job directories at startup.", removed)
    janitor_task = asyncio.create_task(janitor_loop(temp_root))
    worker_task = None
    if enabled:
        worker = VideoWorker()
        await worker.start()
        worker_task = asyncio.create_task(worker.run())
    yield
    for task in (worker_task, janitor_task):
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    if worker:
        await worker.close()
    worker = None


app = FastAPI(title="VICEHUB Video Worker", version="0.2.0", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "worker_enabled": os.getenv("VICEHUB_WORKER_ENABLED", "true").lower() not in {"0", "false", "no"},
        "worker_id": worker.worker_id if worker else None,
    }
