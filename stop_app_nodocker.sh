#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_DIR="$ROOT_DIR/.run"

stop_from_pid_file() {
  local pid_file="$1"
  local name="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "No PID file for ${name} (${pid_file})"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" || true)"

  if [[ -z "$pid" ]]; then
    echo "Empty PID file for ${name}; removing."
    rm -f "$pid_file"
    return 0
  fi

  if ps -p "$pid" >/dev/null 2>&1; then
    echo "Stopping ${name} (pid ${pid})"
    kill "$pid" >/dev/null 2>&1 || true

    for _ in {1..10}; do
      if ! ps -p "$pid" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    if ps -p "$pid" >/dev/null 2>&1; then
      echo "Force killing ${name} (pid ${pid})"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  else
    echo "${name} already stopped (stale pid ${pid})"
  fi

  rm -f "$pid_file"
}

stop_from_pid_file "$RUN_DIR/frontend.pid" "frontend"
stop_from_pid_file "$RUN_DIR/beat.pid" "celery beat"
stop_from_pid_file "$RUN_DIR/worker.pid" "celery worker"
stop_from_pid_file "$RUN_DIR/backend.pid" "backend api"
stop_from_pid_file "$RUN_DIR/qwen.pid" "qwen model server"

echo "No-docker processes stopped."
