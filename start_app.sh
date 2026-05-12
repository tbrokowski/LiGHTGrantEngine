#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ADMIN_EMAIL="${ADMIN_EMAIL:-tbrokowski@yahoo.com}"
ADMIN_NAME="${ADMIN_NAME:-Trevor Brokowski}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-password}"
SEED_XLSX_PATH="${SEED_XLSX_PATH:-/mloscratch/users/brokowsk/LiGHTGrantEngine/Opportunities.xlsx}"
QWEN_MODEL="${QWEN_MODEL:-Qwen/Qwen2.5-72B-Instruct}"
QWEN_HOST="${QWEN_HOST:-0.0.0.0}"
QWEN_PORT="${QWEN_PORT:-8001}"
QWEN_TP_SIZE="${QWEN_TP_SIZE:-3}"
QWEN_MAX_MODEL_LEN="${QWEN_MAX_MODEL_LEN:-8192}"
START_MODEL="${START_MODEL:-1}"

RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"
QWEN_PID_FILE="$RUN_DIR/qwen.pid"
QWEN_LOG_FILE="$LOG_DIR/qwen.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

ensure_python_module() {
  local module="$1"
  local package="$2"
  if ! python -c "import ${module}" >/dev/null 2>&1; then
    echo "==> Missing Python module '${module}', installing '${package}'"
    python -m pip install "$package"
  fi
}

ensure_vllm_ready() {
  if ! python -c "import vllm" >/dev/null 2>&1; then
    echo "==> vLLM import failed; installing/upgrading vllm + compatible openai"
    python -m pip install --upgrade "openai>=1.109.0" vllm
  fi
}

require_command() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command '$cmd' not found."
    echo "$install_hint"
    exit 1
  fi
}

echo "==> Ensuring .env exists"
if [[ ! -f ".env" ]]; then
  cp ".env.example" ".env"
  SECRET="$(python -c "import secrets; print(secrets.token_urlsafe(48))")"
  python - <<PY
from pathlib import Path
p = Path(".env")
content = p.read_text()
content = content.replace("SECRET_KEY=change-me-to-a-long-random-string", "SECRET_KEY=${SECRET}")
content = content.replace("QWEN_API_KEY=EMPTY", "QWEN_API_KEY=EMPTY")
p.write_text(content)
PY
  echo "Created .env with generated SECRET_KEY"
fi

ensure_python_module "yaml" "pyyaml"
require_command "docker" "Install Docker Engine + Docker Compose plugin, then rerun ./start_app.sh"

echo "==> Updating config.yaml AI endpoint for Docker->host connectivity"
python - <<PY
from pathlib import Path
import yaml

cfg_path = Path("config.yaml")
cfg = yaml.safe_load(cfg_path.read_text())
ai = cfg.setdefault("ai", {})
emb = ai.setdefault("embeddings", {})
base_url = "http://host.docker.internal:${QWEN_PORT}/v1"
ai["base_url"] = base_url
ai["model"] = "${QWEN_MODEL}"
ai["api_key"] = "EMPTY"
emb["base_url"] = base_url
emb["model"] = "${QWEN_MODEL}"
cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False))
print(f"config.yaml updated: ai.base_url={base_url}, ai.model=${QWEN_MODEL}")
PY

if [[ "$START_MODEL" == "1" ]]; then
  echo "==> Starting Qwen model server (vLLM) on :${QWEN_PORT}"
  if [[ -f "$QWEN_PID_FILE" ]] && ps -p "$(cat "$QWEN_PID_FILE")" >/dev/null 2>&1; then
    echo "Qwen server already running (pid $(cat "$QWEN_PID_FILE"))"
  else
    if ! command -v python >/dev/null 2>&1; then
      echo "ERROR: python not found."
      exit 1
    fi
    ensure_vllm_ready
    nohup python -m vllm.entrypoints.openai.api_server \
      --model "$QWEN_MODEL" \
      --tensor-parallel-size "$QWEN_TP_SIZE" \
      --host "$QWEN_HOST" \
      --port "$QWEN_PORT" \
      --max-model-len "$QWEN_MAX_MODEL_LEN" \
      > "$QWEN_LOG_FILE" 2>&1 &
    echo $! > "$QWEN_PID_FILE"
    echo "Qwen PID: $(cat "$QWEN_PID_FILE") (logs: $QWEN_LOG_FILE)"
  fi
else
  echo "==> Skipping model startup (START_MODEL=$START_MODEL)"
fi

echo "==> Starting Docker services"
docker compose up -d

echo "==> Running migrations"
docker compose exec backend alembic upgrade head

echo "==> Preparing helper scripts in backend container"
docker compose exec backend mkdir -p /app/scripts
docker cp "$ROOT_DIR/scripts/create_admin.py" light_backend:/app/scripts/create_admin.py
docker cp "$ROOT_DIR/scripts/seed_opportunities.py" light_backend:/app/scripts/seed_opportunities.py

echo "==> Creating/updating admin user"
docker compose exec backend python /app/scripts/create_admin.py "$ADMIN_EMAIL" "$ADMIN_NAME" "$ADMIN_PASSWORD"

if [[ -n "$SEED_XLSX_PATH" ]]; then
  if [[ ! -f "$SEED_XLSX_PATH" ]]; then
    echo "ERROR: SEED_XLSX_PATH file not found: $SEED_XLSX_PATH"
    exit 1
  fi
  echo "==> Seeding opportunities from: $SEED_XLSX_PATH"
  docker cp "$SEED_XLSX_PATH" light_backend:/tmp/Opportunities.xlsx
  docker compose exec backend python /app/scripts/seed_opportunities.py /tmp/Opportunities.xlsx
else
  echo "==> Skipping seed (set SEED_XLSX_PATH to enable)"
fi

echo ""
echo "Startup complete."
echo "Frontend: http://localhost:3000"
echo "API docs:  http://localhost:8000/api/docs"
echo "Admin:     $ADMIN_EMAIL"
echo ""
echo "Tip: follow model logs with:"
echo "  tail -f \"$QWEN_LOG_FILE\""
