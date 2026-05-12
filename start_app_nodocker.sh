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

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

QWEN_PID_FILE="$RUN_DIR/qwen.pid"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
WORKER_PID_FILE="$RUN_DIR/worker.pid"
BEAT_PID_FILE="$RUN_DIR/beat.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

QWEN_LOG_FILE="$LOG_DIR/qwen.log"
BACKEND_LOG_FILE="$LOG_DIR/backend.log"
WORKER_LOG_FILE="$LOG_DIR/worker.log"
BEAT_LOG_FILE="$LOG_DIR/beat.log"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.log"

VENV_PYTHON="$ROOT_DIR/.venv/bin/python"
VENV_PIP="$ROOT_DIR/.venv/bin/pip"

require_command() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command '$cmd' not found."
    echo "$hint"
    exit 1
  fi
}

ensure_python_module() {
  local module="$1"
  local package="$2"
  if ! "$VENV_PYTHON" -c "import ${module}" >/dev/null 2>&1; then
    echo "==> Missing module '${module}', installing '${package}'"
    "$VENV_PIP" install "$package"
  fi
}

ensure_vllm_ready() {
  if ! "$VENV_PYTHON" -c "import vllm" >/dev/null 2>&1; then
    echo "==> vLLM import failed; installing/upgrading vllm + compatible openai"
    "$VENV_PIP" install --upgrade "openai>=1.109.0" vllm
  fi
}

check_backend_dependencies() {
  "$VENV_PYTHON" - <<'PY'
import os
import socket
from pathlib import Path
from urllib.parse import urlparse

def load_dotenv(path: Path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env

def check_tcp(host: str, port: int, name: str):
    try:
        with socket.create_connection((host, port), timeout=2):
            print(f"OK: {name} reachable at {host}:{port}")
            return True
    except OSError:
        print(f"ERROR: {name} not reachable at {host}:{port}")
        return False

env_file = load_dotenv(Path(".env"))
db_url = env_file.get("DATABASE_URL", "postgresql://light:light@localhost:5432/light_grants")
redis_url = env_file.get("REDIS_URL", "redis://localhost:6379/0")

db = urlparse(db_url)
rd = urlparse(redis_url)

db_host = db.hostname or "localhost"
db_port = db.port or 5432
rd_host = rd.hostname or "localhost"
rd_port = rd.port or 6379

ok_db = check_tcp(db_host, db_port, "PostgreSQL")
ok_redis = check_tcp(rd_host, rd_port, "Redis")

if not (ok_db and ok_redis):
    print("")
    print("Start required services first, then rerun start_app_nodocker.sh")
    print("Example (if available):")
    print("  postgres: pg_ctl -D <data_dir> start")
    print("  redis:    redis-server --daemonize yes")
    raise SystemExit(1)
PY
}

start_bg() {
  local pid_file="$1"
  local log_file="$2"
  shift 2

  if [[ -f "$pid_file" ]] && ps -p "$(cat "$pid_file")" >/dev/null 2>&1; then
    echo "Already running (pid $(cat "$pid_file")) -> $log_file"
    return 0
  fi

  nohup "$@" >"$log_file" 2>&1 &
  echo $! >"$pid_file"
  echo "Started pid $(cat "$pid_file") -> $log_file"
}

echo "==> Preflight"
require_command "python3" "Install Python 3 and rerun."
require_command "npm" "Install Node.js + npm and rerun."
if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "ERROR: .venv not found. Create it with:"
  echo "  python3 -m virtualenv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

echo "==> Ensuring .env exists"
if [[ ! -f ".env" ]]; then
  cp ".env.example" ".env"
  SECRET="$("$VENV_PYTHON" -c "import secrets; print(secrets.token_urlsafe(48))")"
  "$VENV_PYTHON" - <<PY
from pathlib import Path
p = Path(".env")
content = p.read_text()
content = content.replace("SECRET_KEY=change-me-to-a-long-random-string", "SECRET_KEY=${SECRET}")
p.write_text(content)
PY
  echo "Created .env with generated SECRET_KEY"
fi

ensure_python_module "yaml" "pyyaml"

echo "==> Updating config.yaml for local no-docker run"
"$VENV_PYTHON" - <<PY
from pathlib import Path
import yaml

cfg_path = Path("config.yaml")
cfg = yaml.safe_load(cfg_path.read_text())
ai = cfg.setdefault("ai", {})
emb = ai.setdefault("embeddings", {})
base_url = "http://localhost:${QWEN_PORT}/v1"
ai["base_url"] = base_url
ai["model"] = "${QWEN_MODEL}"
ai["api_key"] = "EMPTY"
emb["base_url"] = base_url
emb["model"] = "${QWEN_MODEL}"
cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False))
print(f"config.yaml updated: ai.base_url={base_url}, ai.model=${QWEN_MODEL}")
PY

echo "==> Checking PostgreSQL + Redis connectivity"
check_backend_dependencies

if [[ "$START_MODEL" == "1" ]]; then
  echo "==> Starting Qwen model server (vLLM)"
  ensure_vllm_ready
  start_bg "$QWEN_PID_FILE" "$QWEN_LOG_FILE" \
    "$VENV_PYTHON" -m vllm.entrypoints.openai.api_server \
    --model "$QWEN_MODEL" \
    --tensor-parallel-size "$QWEN_TP_SIZE" \
    --host "$QWEN_HOST" \
    --port "$QWEN_PORT" \
    --max-model-len "$QWEN_MAX_MODEL_LEN"
else
  echo "==> Skipping model startup (START_MODEL=$START_MODEL)"
fi

echo "==> Running database migrations"
(
  cd "$ROOT_DIR/backend"
  ../.venv/bin/alembic upgrade head
)

echo "==> Creating/updating admin user"
"$VENV_PYTHON" "$ROOT_DIR/scripts/create_admin.py" "$ADMIN_EMAIL" "$ADMIN_NAME" "$ADMIN_PASSWORD"

if [[ -n "$SEED_XLSX_PATH" ]]; then
  if [[ ! -f "$SEED_XLSX_PATH" ]]; then
    echo "ERROR: SEED_XLSX_PATH file not found: $SEED_XLSX_PATH"
    exit 1
  fi
  echo "==> Seeding opportunities from: $SEED_XLSX_PATH"
  "$VENV_PYTHON" "$ROOT_DIR/scripts/seed_opportunities.py" "$SEED_XLSX_PATH"
else
  echo "==> Skipping seed (SEED_XLSX_PATH is empty)"
fi

echo "==> Writing frontend env"
cat > "$ROOT_DIR/frontend/.env.local" <<EOF
NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
EOF

echo "==> Ensuring frontend dependencies"
(
  cd "$ROOT_DIR/frontend"
  npm install
)

echo "==> Starting backend API"
start_bg "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE" \
  "$VENV_PYTHON" -m uvicorn app.main:app \
  --host "$BACKEND_HOST" \
  --port "$BACKEND_PORT" \
  --reload \
  --app-dir "$ROOT_DIR/backend"

echo "==> Starting Celery worker"
start_bg "$WORKER_PID_FILE" "$WORKER_LOG_FILE" \
  "$ROOT_DIR/.venv/bin/celery" -A app.workers.celery_app worker --loglevel=info

echo "==> Starting Celery beat"
start_bg "$BEAT_PID_FILE" "$BEAT_LOG_FILE" \
  "$ROOT_DIR/.venv/bin/celery" -A app.workers.celery_app beat --loglevel=info

echo "==> Starting frontend"
start_bg "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE" \
  npm --prefix "$ROOT_DIR/frontend" run dev -- --port "$FRONTEND_PORT"

echo ""
echo "No-docker startup complete."
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "API docs:  http://localhost:${BACKEND_PORT}/api/docs"
echo "Admin:     ${ADMIN_EMAIL}"
echo ""
echo "Logs:"
echo "  tail -f \"$QWEN_LOG_FILE\""
echo "  tail -f \"$BACKEND_LOG_FILE\""
echo "  tail -f \"$WORKER_LOG_FILE\""
echo "  tail -f \"$BEAT_LOG_FILE\""
echo "  tail -f \"$FRONTEND_LOG_FILE\""
