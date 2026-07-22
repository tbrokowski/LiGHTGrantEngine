"""
Shared synchronous SQLAlchemy engine for Celery workers and sync code paths.

Why this exists: the codebase previously called ``create_engine(...)``
at ~48 sites — many *inside* Celery task functions, so a fresh engine (and its
own connection pool) was created on every task run and never disposed. Each
leaked pool held idle connections open until garbage collection, so a long-lived
worker steadily consumed Postgres connections until deploys/migrations failed
with "FATAL: sorry, too many clients already".

This module exposes a single process-cached engine with a small, bounded pool.
One engine per process → no per-task leak; a small pool → a tight, predictable
per-process connection footprint. Sizes are env-tunable so each Railway service
(web / worker / beat) can be capped independently without code changes.
"""
import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.config import get_settings

# Small by design: Celery runs with --pool=solo (one task at a time per
# process), so a couple of connections is plenty. Bounded + shared = no leak.
_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "2"))
_MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", "3"))
_POOL_RECYCLE = int(os.environ.get("DB_POOL_RECYCLE", "1800"))  # 30 min


@lru_cache(maxsize=1)
def get_sync_engine() -> Engine:
    """Return the process-wide shared synchronous engine (created once)."""
    return create_engine(
        get_settings().database_url,
        pool_size=_POOL_SIZE,
        max_overflow=_MAX_OVERFLOW,
        pool_pre_ping=True,       # drop dead connections instead of erroring
        pool_recycle=_POOL_RECYCLE,
    )
