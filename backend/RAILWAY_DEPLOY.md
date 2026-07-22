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

## Database connection exhaustion ("FATAL: sorry, too many clients already")

Symptom: the pre-deploy Alembic migration fails to get a connection because the
running services have exhausted Postgres. Root cause (fixed in code): the app
opened far too many connections.

- The async engine (`app/database.py`) previously allowed `pool_size=10 +
  max_overflow=20` = up to **30** connections for the web service alone. Now
  **5 + 5 = 10** by default.
- Celery tasks called `create_engine()` at ~48 sites, many *inside* task
  functions, creating a fresh pool per run and leaking idle connections. All now
  use one shared, process-cached, small-pool engine (`app/db_sync.py`,
  **2 + 3 = 5** max per process) that never leaks.
- Alembic already uses `NullPool` + `dispose()` (one connection, released
  immediately), so migrations were never the cause — they were just the victim.

**Worst-case footprint after the fix:** web ~15, each worker/beat ~5, Alembic 1
— comfortably under Railway Postgres' default `max_connections`.

All pool sizes are env-tunable per service (set on the Railway service, no code
change): `DB_ASYNC_POOL_SIZE`, `DB_ASYNC_MAX_OVERFLOW` (web/async engine),
`DB_POOL_SIZE`, `DB_MAX_OVERFLOW` (sync/worker engine), `DB_POOL_RECYCLE` (both).

### Optional: PgBouncer

If you later add a PgBouncer service (transaction pooling) and point the app at
it via `DATABASE_URL`, two adjustments are needed because asyncpg uses server-
side prepared statements that break under transaction pooling:

1. In `app/database.py`, pass
   `connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0}`
   to `create_async_engine` and use `poolclass=NullPool` (let PgBouncer pool).
2. Keep the sync engine's pool small (PgBouncer multiplexes anyway).

The code-level pool caps above are the primary fix; PgBouncer is only needed if
you scale to many services or a very low-connection Postgres plan.
