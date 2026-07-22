"""Background archive indexing tasks."""
import asyncio
from app.db_sync import get_sync_engine
import logging

from celery.exceptions import MaxRetriesExceededError as MaxRetriesExceeded, SoftTimeLimitExceeded
from celery.signals import worker_ready

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

LOCK_TTL = 600  # seconds — covers the slowest expected indexing run
STALE_THRESHOLD_MINUTES = 20  # archives stuck in processing longer than this are re-queued


def _mark_failed(archive_id: str, error_msg: str) -> None:
    """Set indexing_status=failed using a sync session (safe to call from exception handlers)."""
    from sqlalchemy import text

    from app.db_sync import get_sync_engine

    engine = get_sync_engine()
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
    # NB: do NOT dispose — the engine is a shared, process-cached singleton.


def _recover_stale_archives() -> list[str]:
    """
    Find archives stuck in 'processing' for longer than STALE_THRESHOLD_MINUTES,
    reset them to 'pending', and re-queue indexing. Returns list of archive IDs recovered.
    """
    from sqlalchemy import create_engine, text
    from datetime import datetime, timezone, timedelta

    from app.config import get_settings

    settings = get_settings()
    engine = get_sync_engine()
    recovered: list[str] = []
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_THRESHOLD_MINUTES)
        with engine.connect() as conn:
            # Find archives stuck in processing longer than the stale threshold.
            # Use COALESCE so archives without an updated_at timestamp are always caught.
            rows = conn.execute(
                text(
                    "SELECT id FROM grant_archives "
                    "WHERE indexing_status = 'processing' "
                    "AND COALESCE(updated_at, created_at, NOW() - INTERVAL '1 hour') < :cutoff"
                ),
                {"cutoff": cutoff},
            ).fetchall()

            stale_ids = [str(row[0]) for row in rows]
            if stale_ids:
                for archive_id in stale_ids:
                    conn.execute(
                        text(
                            "UPDATE grant_archives SET indexing_status = 'pending', "
                            "indexing_error = 'Requeued after worker restart' "
                            "WHERE id = :id"
                        ),
                        {"id": archive_id},
                    )
                conn.commit()
                for archive_id in stale_ids:
                    celery_app.send_task(
                        "app.workers.archive_tasks.index_archive",
                        args=[archive_id],
                    )
                    recovered.append(archive_id)
                    logger.info("Recovered stale archive %s — re-queued indexing", archive_id)
    except Exception as e:
        logger.error("Error recovering stale archives: %s", e)
    finally:
        pass  # shared, process-cached engine — never dispose
    return recovered


@worker_ready.connect
def recover_stale_on_startup(sender, **kwargs):
    """Re-queue any archives stuck in 'processing' when the worker starts up."""
    try:
        recovered = _recover_stale_archives()
        if recovered:
            logger.info(
                "worker_ready: recovered %d stale archive(s): %s",
                len(recovered),
                recovered,
            )
        else:
            logger.info("worker_ready: no stale archives found")
    except Exception as e:
        logger.error("worker_ready recovery failed: %s", e)


@celery_app.task(
    name="app.workers.archive_tasks.recover_stale_archive_tasks",
    bind=False,
    max_retries=0,
)
def recover_stale_archive_tasks() -> dict:
    """Periodic watchdog: re-queue archives stuck in 'processing' for too long."""
    recovered = _recover_stale_archives()
    return {"recovered": recovered, "count": len(recovered)}


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
        result = asyncio.run(_run())
        # Trigger archive re-clustering after indexing succeeds. Delay 5 minutes
        # to give the embed_section Celery jobs time to populate section embeddings.
        from app.workers.celery_app import celery_app as _app
        _app.send_task(
            "app.workers.archive_clustering_tasks.cluster_archives",
            countdown=300,
        )
        return result
    except SoftTimeLimitExceeded:
        logger.error("index_archive timed out for %s", archive_id)
        _mark_failed(
            archive_id,
            "Indexing timed out — the document may be too large or the AI service was slow.",
        )
        return {"error": "timed_out", "archive_id": archive_id}
    except MaxRetriesExceeded:
        logger.error("index_archive exceeded max retries for %s", archive_id)
        _mark_failed(
            archive_id,
            "Indexing failed after multiple attempts. Click 'Re-index' to try again.",
        )
        return {"error": "max_retries", "archive_id": archive_id}
    except Exception as exc:
        logger.error("index_archive failed for %s: %s", archive_id, exc)
        try:
            raise self.retry(exc=exc, countdown=120) from exc
        except MaxRetriesExceeded:
            logger.error("index_archive exceeded max retries for %s", archive_id)
            _mark_failed(
                archive_id,
                "Indexing failed after multiple attempts. Click 'Re-index' to try again.",
            )
            return {"error": "max_retries", "archive_id": archive_id}
    finally:
        redis.delete(lock_key)


@celery_app.task(
    name="app.workers.archive_tasks.index_workspace_document",
    bind=True,
    max_retries=5,
    default_retry_delay=30,
    soft_time_limit=120,
    time_limit=150,
)
def index_workspace_document(self, document_id: str, grant_id: str) -> dict:
    """
    Chunk a workspace-uploaded reference document into ProposalSection rows
    linked to grant_id so they participate in per-grant RAG retrieval.

    Called automatically after a workspace file is uploaded (when grant_id is set).
    Retries up to 5 times (30s apart) waiting for parse_and_embed_document to
    populate parsed_text before chunking.
    """
    from sqlalchemy import create_engine, text as sa_text
    from sqlalchemy.orm import Session

    from app.config import get_settings
    from app.models.section import ProposalSection
    from app.services.archive_ingestion import split_text_into_sections, _infer_section_type

    settings = get_settings()
    engine = get_sync_engine()

    try:
        with engine.connect() as conn:
            # Fetch the document
            row = conn.execute(
                sa_text("SELECT id, file_name, parsed_text FROM documents WHERE id = :id"),
                {"id": document_id},
            ).fetchone()

            if not row:
                logger.error("index_workspace_document: document %s not found", document_id)
                return {"error": "not_found", "document_id": document_id}

            parsed_text = row[2]
            file_name = row[1] or "Reference document"

            # Wait for parsing to complete — retry if text not ready yet
            if not parsed_text or not parsed_text.strip():
                logger.info(
                    "index_workspace_document: parsed_text not ready for %s, retrying",
                    document_id,
                )
                raise self.retry(countdown=30)

            # Delete any previously indexed sections for this document+grant
            conn.execute(
                sa_text(
                    "DELETE FROM proposal_sections WHERE document_id = :doc_id AND grant_id = :grant_id"
                ),
                {"doc_id": document_id, "grant_id": grant_id},
            )
            conn.commit()

            # Split text into sections
            raw_sections = split_text_into_sections(parsed_text)
            if not raw_sections:
                raw_sections = [("Full Document", parsed_text.strip())]

            # Insert ProposalSection rows
            section_ids = []
            for order, (title, body) in enumerate(raw_sections):
                if not body.strip():
                    continue
                sid = str(__import__("uuid").uuid4())
                conn.execute(
                    sa_text("""
                        INSERT INTO proposal_sections
                          (id, document_id, grant_id, grant_title, section_type, section_title,
                           section_text, section_order, word_count, ai_retrieval_allowed,
                           text_reuse_allowed, paraphrase_allowed, created_at)
                        VALUES
                          (:id, :document_id, :grant_id, :grant_title, :section_type,
                           :section_title, :section_text, :section_order, :word_count,
                           true, true, true, NOW())
                    """),
                    {
                        "id": sid,
                        "document_id": document_id,
                        "grant_id": grant_id,
                        "grant_title": file_name,
                        "section_type": _infer_section_type(title),
                        "section_title": title[:500],
                        "section_text": body,
                        "section_order": order,
                        "word_count": len(body.split()),
                    },
                )
                section_ids.append(sid)
            conn.commit()

            # Queue embeddings for each section
            for sid in section_ids:
                celery_app.send_task(
                    "app.workers.embedding_tasks.embed_section",
                    args=[sid],
                )

            logger.info(
                "index_workspace_document: indexed %d sections for doc %s in grant %s",
                len(section_ids),
                document_id,
                grant_id,
            )
            return {"sections_indexed": len(section_ids), "document_id": document_id, "grant_id": grant_id}

    except self.MaxRetriesExceededError:
        logger.error(
            "index_workspace_document: max retries exceeded for doc %s", document_id
        )
        return {"error": "max_retries", "document_id": document_id}
    except Exception as exc:
        logger.error("index_workspace_document failed for %s: %s", document_id, exc)
        try:
            raise self.retry(exc=exc, countdown=30) from exc
        except Exception:
            return {"error": str(exc), "document_id": document_id}
    finally:
        pass  # shared, process-cached engine — never dispose
