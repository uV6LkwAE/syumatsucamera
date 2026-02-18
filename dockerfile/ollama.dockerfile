# syntax=docker/dockerfile:1.7
FROM ollama/ollama:latest
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache bash; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "No supported package manager found; bash install skipped"; \
      exit 1; \
    fi
