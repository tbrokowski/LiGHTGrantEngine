# Railway deployment — worker & beat services

This backend needs **three** running processes (see `Procfile`):

```
web:    uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
worker: celery -A app.workers.celery_app worker --pool=solo --loglevel info
beat:   celery -A app.workers.celery_app beat --loglevel info
```

`nixpacks.toml` only overrides the start command for the `web` process. If Railway
is only running `web`, source scans, re-scoring, clustering, and notifications
all get queued via the API but **never execute** — this is very likely why
scraping currently appears "paused." Check Settings → Data Sources → the
worker-status banner at the top: if it says "Worker offline," this is confirmed.

Railway does not run Procfile-style multi-process services automatically from a
single deploy — each process type needs its own Railway service. To fix:

1. In the Railway project, add **two new services**, each pointing at this same
   repo with root directory `backend` (same as the existing `web` service).
2. For each new service, open **Settings → Deploy → Custom Start Command** and
   set it to the corresponding line from `Procfile`:
   - `worker` service: `celery -A app.workers.celery_app worker --pool=solo --loglevel info`
   - `beat` service: `celery -A app.workers.celery_app beat --loglevel info`
3. Give both new services the **same environment variables** as `web`
   (`DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, etc.) — Railway's "Shared
   Variables" (project-level) or "Reference Variables" (point at another
   service's value) make this easy without duplicating secrets by hand.
4. Deploy both, then confirm in Settings → Data Sources that the worker-status
   banner turns green ("Worker online").

No code change fixes this — it's a one-time dashboard configuration action.
