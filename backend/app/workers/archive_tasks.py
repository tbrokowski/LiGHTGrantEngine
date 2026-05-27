"""Background archive indexing tasks."""
import asyncio
import logging

from celery.exceptions import SoftTimeLimitExceeded

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

LOCK_TTL = 600  # seconds — covers the slowest expected indexing run


def _mark_failed(archive_id: str, error_msg: str) -> None:
    """Set indexing_status=failed using a sync session (safe to call from exception handlers)."""
    from sqlalchemy import create_engine, text

    from app.config import get_settings

    settings = get_settings()
    db_url = settings.database_url
    engine = create_engine(db_url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            conn.execute(
                text(
                    "UPDATE grant_archives SET indexing_status = 'failed',"
                    " indexing_error = :err WHERE id = :id"
                ),
                {"err": error_msg[:2000], "id": archive_id},
            )
            conn.commit()
    except Exception as e:
        logger.error("_mark_failed could not update archive %s: %s", archive_id, e)
    finally:
        engine.dispose()


@celery_app.task(
    name="app.workers.archive_tasks.index_archive",
    bind=True,
    max_retries=2,
    soft_time_limit=480,
    time_limit=540,
)
def index_archive(self, archive_id: str) -> dict:
    """Parse archive documents and index the submitted proposal for RAG retrieval."""
    from redis import Redis
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.config import get_settings
    from app.services.archive_ingestion import run_archive_indexing

    settings = get_settings()
    db_url = settings.database_url.replace(
        "postgresql://", "postgresql+asyncpg://"
    ).replace("postgres://", "postgresql+asyncpg://")

    redis = Redis.from_url(settings.redis_url)
    lock_key = f"archive_index_lock:{archive_id}"
    acquired = redis.set(lock_key, "1", nx=True, ex=LOCK_TTL)
    if not acquired:
        logger.info("index_archive skipping %s — already running", archive_id)
        return {"skipped": True, "archive_id": archive_id}

    async def _run() -> dict:
        engine = create_async_engine(db_url, echo=False)
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            async with session_factory() as db:
                return await run_archive_indexing(db, archive_id)
        finally:
            await engine.dispose()

    try:
        return asyncio.run(_run())
    except SoftTimeLimitExceeded:
        logger.error("index_archive timed out for %s", archive_id)
        _mark_failed(
            archive_id,
            "Indexing timed out — the document may be too large or the AI service was slow.",
        )
        return {"error": "timed_out", "archive_id": archive_id}
    except Exception as exc:
        logger.error("index_archive failed for %s: %s", archive_id, exc)
        raise self.retry(exc=exc, countdown=120) from exc
    finally:
        redis.delete(lock_key)
