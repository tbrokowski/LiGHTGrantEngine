# Pin to Debian Bookworm — Trixie (slim default) breaks Playwright --with-deps font packages.
FROM python:3.11-slim-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    gcc libpq-dev curl poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Fresh apt-get update is required here because the earlier layer wiped
# /var/lib/apt/lists/*. --with-deps calls apt-get install internally so
# it needs up-to-date package lists available in the same RUN step.
RUN apt-get update \
    && playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 8000
