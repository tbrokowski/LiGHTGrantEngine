#!/usr/bin/env bash
# ============================================================
#  start_app_local.sh
#  Run this on your LOCAL machine to start the full app stack
#  (Postgres, Redis, backend, Celery, frontend) using OpenAI.
#
#  Usage:
#    ./start_app_local.sh --openai-key sk-...
#
#  The key can also be pre-set in your environment or .env:
#    export OPENAI_API_KEY=sk-...
#    ./start_app_local.sh
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# ── Load .env early so variables are available before arg parsing ─────
if [[ -f ".env" ]]; then
    set -o allexport
    # shellcheck disable=SC1091
    source ".env"
    set +o allexport
fi

# ── Parse arguments ──────────────────────────────────────────────────
ADMIN_EMAIL="${ADMIN_EMAIL:-tbrokowski@yahoo.com}"
ADMIN_NAME="${ADMIN_NAME:-Trevor Brokowski}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"
SEED_XLSX_PATH="${SEED_XLSX_PATH:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --openai-key)
            OPENAI_API_KEY="$2"
            shift 2
            ;;
        --admin-email)
            ADMIN_EMAIL="$2"
            shift 2
            ;;
        --admin-password)
            ADMIN_PASSWORD="$2"
            shift 2
            ;;
        --seed)
            SEED_XLSX_PATH="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: $0 [--openai-key sk-...] [--admin-email x] [--admin-password x] [--seed /path/to/file.xlsx]"
            exit 1
            ;;
    esac
done

if [[ -z "$OPENAI_API_KEY" ]]; then
    echo "WARNING: OpenAI API key not provided."
    echo "         Pass it with --openai-key sk-... or set OPENAI_API_KEY in your environment."
    echo "         AI features won't work without a valid key."
    echo ""
fi

echo "============================================="
echo "  LiGHT Grant Engine — local app stack"
echo "============================================="
echo "  Model          : gpt-4o-mini (OpenAI)"
echo "  Embeddings     : text-embedding-3-small"
echo "  Admin email    : $ADMIN_EMAIL"
echo "============================================="
echo ""

# ── Prerequisite checks ──────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker not found. Install Docker Desktop and rerun."
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: 'docker compose' not found. Update Docker Desktop or install the compose plugin."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 not found."
    exit 1
fi

# ── Ensure .env exists ───────────────────────────────────────────────
echo "==> Checking .env"
if [[ ! -f ".env" ]]; then
    cp ".env.example" ".env"
    SECRET="$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")"
    python3 - <<PY
from pathlib import Path
p = Path(".env")
content = p.read_text()
content = content.replace("SECRET_KEY=change-me-to-a-long-random-string", "SECRET_KEY=${SECRET}")
p.write_text(content)
PY
    echo "    Created .env with generated SECRET_KEY"
else
    echo "    .env already exists"
fi

# ── Write OpenAI key into .env if provided ───────────────────────────
if [[ -n "$OPENAI_API_KEY" ]]; then
    echo "==> Writing OPENAI_API_KEY to .env"
    python3 - <<PY
from pathlib import Path
p = Path(".env")
content = p.read_text()
key = "${OPENAI_API_KEY}"
if "OPENAI_API_KEY=" in content:
    import re
    content = re.sub(r"OPENAI_API_KEY=.*", f"OPENAI_API_KEY={key}", content)
else:
    content += f"\nOPENAI_API_KEY={key}\n"
p.write_text(content)
PY
fi

# ── Start Docker services ─────────────────────────────────────────────
echo "==> Starting Docker services"
docker compose up -d --build

# ── Wait for backend to be healthy ───────────────────────────────────
echo "==> Waiting for backend to be ready..."
MAX_WAIT=120
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    if curl -sf --max-time 3 "http://localhost:8000/health" >/dev/null 2>&1 || \
       curl -sf --max-time 3 "http://localhost:8000/api/health" >/dev/null 2>&1; then
        echo "    Backend is up"
        break
    fi
    sleep 5
    ELAPSED=$(( ELAPSED + 5 ))
done

# ── Run migrations ────────────────────────────────────────────────────
echo "==> Running database migrations"
docker compose exec backend alembic upgrade head

# ── Copy helper scripts into container ───────────────────────────────
echo "==> Copying helper scripts"
docker compose exec backend mkdir -p /app/scripts
docker cp "$ROOT_DIR/scripts/create_admin.py"              light_backend:/app/scripts/create_admin.py
docker cp "$ROOT_DIR/scripts/seed_opportunities.py"        light_backend:/app/scripts/seed_opportunities.py
docker cp "$ROOT_DIR/backend/scripts/seed_sources_from_excel.py" light_backend:/app/scripts/seed_sources_from_excel.py

# ── Create admin user ─────────────────────────────────────────────────
echo "==> Creating/updating admin user ($ADMIN_EMAIL)"
docker compose exec backend python /app/scripts/create_admin.py \
    "$ADMIN_EMAIL" "$ADMIN_NAME" "$ADMIN_PASSWORD"

# ── Seed grant sources from Excel ────────────────────────────────────
EXCEL_PATH="$ROOT_DIR/grant_funding_portals.xlsx"
if [[ -f "$EXCEL_PATH" ]]; then
    echo "==> Seeding grant sources from grant_funding_portals.xlsx"
    docker cp "$EXCEL_PATH" light_backend:/tmp/grant_funding_portals.xlsx
    docker compose exec backend python /app/scripts/seed_sources_from_excel.py \
        --excel /tmp/grant_funding_portals.xlsx
fi

# ── Optionally seed opportunities ────────────────────────────────────
if [[ -n "$SEED_XLSX_PATH" ]]; then
    if [[ ! -f "$SEED_XLSX_PATH" ]]; then
        echo "ERROR: Seed file not found: $SEED_XLSX_PATH"
        exit 1
    fi
    echo "==> Seeding opportunities from $SEED_XLSX_PATH"
    docker cp "$SEED_XLSX_PATH" light_backend:/tmp/Opportunities.xlsx
    docker compose exec backend python /app/scripts/seed_opportunities.py /tmp/Opportunities.xlsx
fi

echo ""
echo "============================================="
echo "  Startup complete"
echo "============================================="
echo "  Frontend  : http://localhost:3000"
echo "  API docs  : http://localhost:8000/api/docs"
echo "  Model     : gpt-4o-mini (OpenAI)"
echo "  Admin     : $ADMIN_EMAIL"
echo ""
echo "  Follow logs:"
echo "    docker compose logs -f backend"
echo "    docker compose logs -f worker"
echo ""
echo "  To stop:"
echo "    docker compose down"
echo "============================================="
