#!/bin/bash
# Start OnlyOffice through its stock script, then make sure nginx is actually
# up: the stock script runs `service nginx start` and swallows the error, which
# leaves the container healthy-looking but refusing every connection on :80.
(
  sleep 45
  if ! { [ -f /run/nginx.pid ] && kill -0 "$(cat /run/nginx.pid)" 2>/dev/null; }; then
    echo "[light] nginx is not running after startup. Config test:"
    nginx -t 2>&1
    tail -n 20 /var/log/nginx/error.log 2>/dev/null
    echo "[light] Starting nginx directly"
    nginx 2>&1 && echo "[light] nginx started"
  else
    echo "[light] nginx is running"
  fi
  # Which config files nginx loaded and what each listens on.
  nginx -T 2>/dev/null | grep -E '^# configuration file|^\s*listen\s' | sed 's/^/[light] /'
) &

exec /app/ds/run-document-server.sh "$@"
