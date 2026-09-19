FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# libmagic/ffmpeg are what audio and document handling reach for; curl is the
# container health check.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# Uploads and models are written at runtime, so they need an owner that is
# not root.
RUN mkdir -p /data/uploads && useradd --create-home --uid 1000 recallai \
    && chown -R recallai:recallai /app /data
USER recallai

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
