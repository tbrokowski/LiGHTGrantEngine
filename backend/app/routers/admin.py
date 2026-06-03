"""Admin endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User
from app.routers.auth import get_current_user
from app.config import get_settings

router = APIRouter()
settings = get_settings()

def _require_admin(current_user: User):
    if current_user.role != "admin":
        raise HTTPException(403, "Admin access required")

def _require_admin_or_org_admin(current_user: User):
    """Allow platform admins or institution admins (institution_role=admin)."""
    if current_user.role == "admin":
        return
    if current_user.institution_role == "admin":
        return
    raise HTTPException(403, "Admin access required")

@router.get("/config")
async def get_config(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    return {
        "model": settings.ai.model,
        "ai_base_url": settings.ai.base_url,
        "environment": settings.environment,
        "app_name": settings.app_name,
    }

@router.get("/health/db")
async def db_health(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    result = await db.execute(text("SELECT 1"))
    return {"db": "ok", "result": result.scalar()}

@router.post("/reindex")
async def trigger_reindex(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.embedding_tasks.reindex_all")
    return {"message": "Re-indexing queued"}


@router.post("/resync-feeds")
async def resync_feeds(
    institution_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Force-resync InstitutionOpportunity records so all existing opportunities
    are surfaced to every institution (or a specific one) with fresh scoring.

    Fixes 'opportunities disappeared' issues caused by:
    - Keyword filter changes that archived previously-visible opportunities
    - Missing InstitutionOpportunity rows after a DB migration or first boot
    - Status stuck on 'archived' after profile changes
    """
    _require_admin(current_user)
    import asyncio
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings as gs
    from app.services.grant_bootstrap import (
        bootstrap_institution_feed,
        bootstrap_all_institution_feeds,
        fan_out_sources_to_institutions,
    )

    settings_obj = gs()

    def _run_sync():
        engine = create_engine(settings_obj.database_url)
        with Session(engine) as session:
            fan_out_sources_to_institutions(session)
            if institution_id:
                count = bootstrap_institution_feed(session, institution_id, force=True)
                return {"institution_id": institution_id, "opportunities_resynced": count}
            else:
                count = bootstrap_all_institution_feeds(session, force=True)
                return {"institution_id": "all", "opportunities_resynced": count}

    result = await asyncio.get_event_loop().run_in_executor(None, _run_sync)
    return result


@router.post("/trigger/discover-sources")
async def trigger_discover_sources(current_user: User = Depends(get_current_user)):
    """Queue a discover_new_sources Celery task."""
    _require_admin_or_org_admin(current_user)
    from app.workers.celery_app import celery_app
    task = celery_app.send_task("app.workers.discovery_tasks.discover_new_sources")
    return {"message": "Source discovery task queued", "task_id": task.id}


@router.post("/trigger/backfill-opportunity-types")
async def trigger_backfill_types(current_user: User = Depends(get_current_user)):
    """Queue the opportunity_type backfill task for opportunities missing a type."""
    _require_admin_or_org_admin(current_user)
    from app.workers.celery_app import celery_app
    task = celery_app.send_task("app.workers.discovery_tasks.backfill_opportunity_types")
    return {"message": "Type backfill task queued", "task_id": task.id}


@router.post("/deduplicate-opportunities")
async def run_dedup(current_user: User = Depends(get_current_user)):
    """Run a synchronous dedup scan across all opportunities.

    Marks confirmed duplicates (status=duplicate, hidden from all listing
    endpoints) and flags medium-confidence matches as POSSIBLE_DUPLICATE.
    Runs inline — no Celery worker required. Idempotent and safe to re-run.
    """
    _require_admin(current_user)
    import asyncio
    from sqlalchemy import create_engine
    from app.config import get_settings as gs
    from app.workers.dedup_tasks import run_dedup as _run_dedup

    def _run_sync():
        engine = create_engine(gs().database_url)
        return _run_dedup(engine)

    stats = await asyncio.get_event_loop().run_in_executor(None, _run_sync)
    return {
        "message": "Deduplication complete",
        "confirmed_duplicates_removed": stats["confirmed"],
        "possible_duplicates_flagged": stats["possible"],
        "groups_processed": stats["groups_processed"],
    }
