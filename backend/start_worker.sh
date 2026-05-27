#!/bin/bash
# Celery worker startup script with diagnostics.
# Used as the Railway worker service start command.
set -e

echo "=== Worker container starting ==="
echo "Python: $(python --version)"
echo "Working dir: $(pwd)"
echo "REDIS_URL set: $([ -n "$REDIS_URL" ] && echo yes || echo NO)"
echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"

echo "=== Testing Python imports ==="
python -c "
import sys
print('sys.path:', sys.path[:3])
from app.workers.celery_app import celery_app
print('Celery app loaded OK:', celery_app)
print('Broker:', celery_app.conf.broker_url)
"

echo "=== Starting Celery worker ==="
exec celery -A app.workers.celery_app worker --pool=solo --loglevel info
