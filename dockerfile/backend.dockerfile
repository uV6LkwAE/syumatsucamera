# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

FROM base AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip wheel --no-cache-dir --wheel-dir /tmp/wheels -r /tmp/requirements.txt

FROM base AS deps-dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt /tmp/requirements.txt
COPY backend/requirements.dev.txt /tmp/requirements.dev.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt -r /tmp/requirements.dev.txt

FROM base AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libpq5 \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m appuser
RUN mkdir -p /var/log/syumatsucamera /app/logs
COPY --from=builder /tmp/wheels /tmp/wheels
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/tmp/wheels -r /tmp/requirements.txt \
    && rm -rf /tmp/wheels /tmp/requirements.txt
COPY backend /app
RUN chown -R appuser:appuser /var/log/syumatsucamera /app/logs /app
USER appuser
EXPOSE 8000
CMD ["gunicorn", "syumatsucamera.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]

FROM base AS dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps-dev /usr/local /usr/local
COPY backend /app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
