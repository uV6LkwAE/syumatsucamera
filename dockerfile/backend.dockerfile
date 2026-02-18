# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      libpq-dev \
      curl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps-prod
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

FROM base AS deps-dev
COPY backend/requirements.txt /tmp/requirements.txt
COPY backend/requirements.dev.txt /tmp/requirements.dev.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt -r /tmp/requirements.dev.txt

FROM base AS runtime
RUN useradd -m appuser
RUN mkdir -p /var/log/syumatsucamera /app/logs
COPY --from=deps-prod /usr/local /usr/local
COPY backend /app
RUN chown -R appuser:appuser /var/log/syumatsucamera /app/logs /app
USER appuser
EXPOSE 8000
CMD ["gunicorn", "syumatsucamera.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]

FROM base AS dev
COPY --from=deps-dev /usr/local /usr/local
COPY backend /app
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
