"""Background archive indexing tasks."""
import asyncio
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.archive_tasks.index_archive", bind=True, max_retries=2)
def index_archive(self, archive_id: str) -> dict:
    """Parse archive documents and index the submitted proposal for RAG retrieval."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.config import get_settings
    from app.services.archive_ingestion import run_archive_indexing

    settings = get_settings()
    db_url = settings.database_url.replace(
        "postgresql://", "postgresql+asyncpg://"
    ).replace("postgres://", "postgresql+asyncpg://")

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
    except Exception as exc:
        logger.error("index_archive failed for %s: %s", archive_id, exc)
        raise self.retry(exc=exc, countdown=120) from exc
