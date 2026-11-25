FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WHISPER_MODEL_DIR=/models \
    VIDEO_TEMP_DIR=/tmp/vicehub-video

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /models /tmp/vicehub-video \
    && chown -R worker:worker /app /models /tmp/vicehub-video

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
