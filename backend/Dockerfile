FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    gcc libpq-dev curl poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --with-deps auto-installs the exact system libraries required by the
# installed Chromium version, self-healing on future Playwright upgrades.
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8000
