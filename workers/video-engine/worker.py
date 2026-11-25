import asyncio
import json
import logging
import os
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


def transcribe_media(path: Path, language: str | None) -> tuple[str, str | None]:
    global MODEL
    from faster_whisper import WhisperModel

    if MODEL is None:
        model_size = os.getenv("WHISPER_MODEL", "small")
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
        model_dir = os.getenv("WHISPER_MODEL_DIR", "/models")
        MODEL = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
            download_root=model_dir,
        )

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
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), follow_redirects=False)
        log.info("Worker started; one polling loop is active.")

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

    async def callback(self, job_id: str, payload: dict) -> None:
        await self.request_json("POST", f"/api/internal-video-jobs/{job_id}", json=payload)

    async def progress(self, job_id: str, percent: int, stage: str) -> None:
        await self.callback(job_id, {
            "status": "processing",
            "progressPercent": max(1, min(99, percent)),
            "stage": stage,
        })

    async def download_source(self, source_url: str, target: Path) -> None:
        parsed = urlparse(source_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise RuntimeError("The worker received an invalid private source URL.")
        if not self.client:
            raise RuntimeError("Worker HTTP client is not running.")

        async with self.client.stream("GET", source_url, timeout=None) as response:
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

    async def heartbeat(self, job_id: str) -> None:
        while True:
            await asyncio.sleep(90)
            try:
                await self.progress(job_id, 45, "Processing locally; worker heartbeat")
            except Exception:
                log.warning("Heartbeat could not be delivered for job %s.", job_id)

    async def process(self, job: dict) -> None:
        job_id = str(job.get("id") or "")
        job_type = job.get("type")
        asset = job.get("asset") or {}
        source_url = job.get("sourceUrl") or ""
        if not job_id or job_type not in {"analyse", "transcribe"}:
            raise RuntimeError("The queue returned an unsupported job payload.")

        heartbeat_task = asyncio.create_task(self.heartbeat(job_id))
        try:
            suffix = ".mov" if str(asset.get("mimeType", "")).lower() == "video/quicktime" else ".mp4"
            with tempfile.TemporaryDirectory(prefix="vicehub-", dir=self.temp_root) as work_dir:
                source_path = Path(work_dir) / ("source" + suffix)
                await self.progress(job_id, 5, "Downloading private source to temporary worker storage")
                await self.download_source(source_url, source_path)

                await self.progress(job_id, 20, "Reading media streams with FFprobe")
                metadata = await asyncio.to_thread(probe_media, source_path)

                result = {
                    "status": "succeeded",
                    "progressPercent": 100,
                    "stage": "Media analysis complete" if job_type == "analyse" else "Transcription complete",
                    **metadata,
                }
                if job_type == "transcribe":
                    await self.progress(job_id, 35, "Loading local faster-whisper model")
                    language = str(asset.get("language") or "und")
                    await self.progress(job_id, 40, "Transcribing audio locally")
                    transcript, detected_language = await asyncio.to_thread(
                        transcribe_media,
                        source_path,
                        language,
                    )
                    result["transcript"] = transcript
                    result["resultSummary"] = (
                        f"Local transcription completed; detected language: {detected_language or 'unknown'}."
                    )
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
                except Exception as exc:
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
    task = None
    if enabled:
        worker = VideoWorker()
        await worker.start()
        task = asyncio.create_task(worker.run())
    yield
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    if worker:
        await worker.close()
    worker = None


app = FastAPI(title="VICEHUB Video Worker", version="0.1.0", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "worker_enabled": os.getenv("VICEHUB_WORKER_ENABLED", "true").lower() not in {"0", "false", "no"},
        "worker_id": worker.worker_id if worker else None,
    }
