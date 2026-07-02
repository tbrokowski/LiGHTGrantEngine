"""Grant source management endpoints."""
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.source import Source, SourceRun
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import require_org_admin

logger = logging.getLogger(__name__)

router = APIRouter()


class SourceCreate(BaseModel):
    name: str
    url: Optional[str] = None
    api_endpoint: Optional[str] = None
    source_type: str = "html_static"
    category: Optional[str] = None
    refresh_frequency: str = "weekly"
    relevant_themes: list[str] = []
    relevant_geographies: list[str] = []
    scraper_config: dict = {}
    is_high_priority: bool = False
    auth_required: bool = False
    logo_url: Optional[str] = None
    notes: Optional[str] = None


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    api_endpoint: Optional[str] = None
    status: Optional[str] = None
    refresh_frequency: Optional[str] = None
    is_high_priority: Optional[bool] = None
    scraper_config: Optional[dict] = None
    relevant_themes: Optional[list[str]] = None
    relevant_geographies: Optional[list[str]] = None
    auth_required: Optional[bool] = None
    logo_url: Optional[str] = None
    notes: Optional[str] = None


def _source_to_dict(s: Source) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "url": s.url,
        "api_endpoint": s.api_endpoint,
        "source_type": s.source_type,
        "category": s.category,
        "status": s.status,
        "is_high_priority": s.is_high_priority,
        "auth_required": s.auth_required,
        "refresh_frequency": s.refresh_frequency,
        "logo_url": s.logo_url,
        "notes": s.notes,
        "relevant_themes": s.relevant_themes or [],
        "relevant_geographies": s.relevant_geographies or [],
        "scraper_config": s.scraper_config or {},
        "last_checked": s.last_checked.isoformat() if s.last_checked else None,
        "last_successful_run": s.last_successful_run.isoformat() if s.last_successful_run else None,
        "opportunities_discovered": s.opportunities_discovered,
        "opportunities_added": s.opportunities_added,
        "duplicates_detected": s.duplicates_detected,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/")
async def list_sources(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Source).order_by(Source.name))
    return [_source_to_dict(s) for s in result.scalars().all()]


# ── Status / debug routes — defined BEFORE /{source_id} so FastAPI matches them first ──

@router.get("/status/recent-runs")
async def get_recent_runs(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Most recent source runs across all sources, for the frontend debug panel."""
    result = await db.execute(
        select(SourceRun, Source)
        .join(Source, SourceRun.source_id == Source.id, isouter=True)
        .order_by(desc(SourceRun.started_at))
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "id": r.id,
            "source_id": r.source_id,
            "source_name": s.name if s else r.source_id,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "ended_at": r.ended_at.isoformat() if r.ended_at else None,
            "status": r.status,
            "records_found": r.records_found,
            "new_opportunities": r.new_opportunities,
            "duplicates": r.duplicates,
            "errors": r.errors or [],
            "log_summary": r.log_summary,
        }
        for r, s in rows
    ]


@router.get("/status/summary")
async def get_scan_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dashboard-friendly scraping system health summary."""
    from sqlalchemy import func
    from app.models.opportunity import Opportunity
    from datetime import datetime, timedelta

    src_counts = (await db.execute(
        select(Source.status, func.count(Source.id).label("n"))
        .group_by(Source.status)
    )).all()

    total_opps = (await db.execute(select(func.count(Opportunity.id)))).scalar()

    last_run_row = (await db.execute(
        select(SourceRun).order_by(desc(SourceRun.started_at)).limit(1)
    )).scalar_one_or_none()

    cutoff = datetime.utcnow() - timedelta(hours=24)
    recent_errors = (await db.execute(
        select(func.count(SourceRun.id)).where(
            SourceRun.status == "failed",
            SourceRun.started_at >= cutoff,
        )
    )).scalar()

    running = (await db.execute(
        select(func.count(SourceRun.id)).where(SourceRun.status == "running")
    )).scalar()

    return {
        "sources_by_status": {row[0]: row[1] for row in src_counts},
        "total_opportunities": total_opps,
        "running_scans": running,
        "recent_errors_24h": recent_errors,
        "last_run_at": last_run_row.started_at.isoformat() if last_run_row and last_run_row.started_at else None,
        "last_run_status": last_run_row.status if last_run_row else None,
    }


@router.get("/{source_id}")
async def get_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    return _source_to_dict(source)


@router.post("/", status_code=201, dependencies=[Depends(require_org_admin())])
async def create_source(
    data: SourceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    source = Source(id=str(uuid.uuid4()), owner_id=current_user.id, **data.model_dump())
    db.add(source)
    await db.commit()
    _trigger_fan_out()
    return _source_to_dict(source)


@router.get("/worker-status")
async def get_worker_status(current_user: User = Depends(get_current_user)):
    """Ping Celery workers to check if the discovery pipeline is actually running.

    Returns worker_reachable=True only when at least one worker responds within
    3 seconds. Use this to diagnose 'no new grants' — if False, manual scan
    triggers are being queued but never executed.
    """
    try:
        from app.workers.celery_app import celery_app
        import asyncio

        def _ping():
            inspector = celery_app.control.inspect(timeout=3.0)
            ping_result = inspector.ping() or {}
            active_result = inspector.active() or {}
            workers = list(ping_result.keys())
            active_count = sum(len(v) for v in active_result.values())
            return {"worker_reachable": bool(workers), "workers": workers, "active_tasks": active_count}

        result = await asyncio.get_event_loop().run_in_executor(None, _ping)
        return result
    except Exception as exc:
        return {"worker_reachable": False, "workers": [], "active_tasks": 0, "error": str(exc)}


@router.post("/run-all", dependencies=[Depends(require_org_admin())])
async def run_all_sources(
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Queue a full refresh of all non-paused sources (active, broken, and under_review)."""
    result = await db.execute(
        select(Source).where(Source.status.in_(["active", "broken", "under_review"]))
    )
    count = len(result.scalars().all())
    bg.add_task(_trigger_all_sources_scan)
    return {"message": f"Scan queued for {count} source{'s' if count != 1 else ''}", "queued": count}


@router.patch("/{source_id}", dependencies=[Depends(require_org_admin())])
async def update_source(
    source_id: str,
    data: SourceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(source, k, v)
    await db.commit()
    return _source_to_dict(source)


@router.post("/{source_id}/run-now", dependencies=[Depends(require_org_admin())])
async def run_source_now(
    source_id: str,
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    bg.add_task(_trigger_source_scan, source_id)
    return {"message": f"Scan triggered for {source.name}"}


@router.post("/{source_id}/toggle", dependencies=[Depends(require_org_admin())])
async def toggle_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle a source between active and paused."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    source.status = "paused" if source.status == "active" else "active"
    await db.commit()
    return _source_to_dict(source)


@router.delete("/{source_id}", status_code=204, dependencies=[Depends(require_org_admin())])
async def delete_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete a source and its run history."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    await db.delete(source)
    await db.commit()


@router.get("/{source_id}/runs")
async def get_source_runs(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SourceRun)
        .where(SourceRun.source_id == source_id)
        .order_by(SourceRun.started_at.desc())
        .limit(10)
    )
    runs = result.scalars().all()
    return [
        {
            "id": r.id,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "ended_at": r.ended_at.isoformat() if r.ended_at else None,
            "status": r.status,
            "new_opportunities": r.new_opportunities,
            "updated_opportunities": r.updated_opportunities,
            "duplicates": r.duplicates,
            "records_found": r.records_found,
            "errors": r.errors or [],
            "warnings": r.warnings or [],
            "log_summary": r.log_summary,
            "traceback": r.notes,
        }
        for r in runs
    ]


@router.post("/{source_id}/runs/{run_id}/diagnose", dependencies=[Depends(require_org_admin())])
async def diagnose_run(
    source_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask the LLM to explain why a run failed and suggest scraper_config fixes."""
    src_result = await db.execute(select(Source).where(Source.id == source_id))
    source = src_result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    run_result = await db.execute(
        select(SourceRun).where(SourceRun.id == run_id, SourceRun.source_id == source_id)
    )
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")

    try:
        from app.ai.client import chat_complete

        prompt = f"""A web scraper for grant funding failed. Diagnose the problem and suggest fixes.

SOURCE CONFIG:
  Name: {source.name}
  URL: {source.url or "none"}
  API endpoint: {source.api_endpoint or "none"}
  Scraper type: {source.source_type}
  Scraper config (JSON): {source.scraper_config or {}}

LAST RUN RESULT:
  Status: {run.status}
  Records fetched: {run.records_found}
  New opportunities: {run.new_opportunities}
  Duplicates: {run.duplicates}
  Log summary: {run.log_summary or "none"}
  Errors: {run.errors or []}
  Warnings: {run.warnings or []}
  Traceback (last 1000 chars): {(run.notes or "")[-1000:]}

Respond with a JSON object in exactly this shape:
{{
  "diagnosis": "plain-English explanation of what went wrong (2-4 sentences)",
  "root_cause": "one-line technical root cause",
  "suggested_config": {{... complete scraper_config JSON to replace the current one, or null if no change needed ...}},
  "suggested_type": "scraper type to switch to, or null if unchanged",
  "action_items": ["step 1", "step 2"]
}}

If records_found is 0 and status is success, the scraper ran without error but found nothing — this usually means the page structure changed, JS rendering is needed, pagination is missing, or the URL is wrong.
Return only valid JSON, no markdown.
"""
        raw = await chat_complete(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            json_mode=True,
        )

        import json as _json
        try:
            result = _json.loads(raw)
        except Exception:
            result = {"diagnosis": raw, "root_cause": None, "suggested_config": None, "suggested_type": None, "action_items": []}

        return result
    except Exception as e:
        raise HTTPException(500, f"Diagnosis failed: {e}")


# ── Internal helpers (sync — called from BackgroundTasks) ─────────────────────

def _trigger_source_scan(source_id: str) -> None:
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.discovery_tasks.scan_source", args=[source_id])
        logger.info("Queued scan for source_id=%s", source_id)
    except Exception as exc:
        logger.error("Failed to queue scan for source_id=%s: %s", source_id, exc)


def _trigger_all_sources_scan() -> None:
    try:
        from app.workers.celery_app import celery_app
        result = celery_app.send_task("app.workers.discovery_tasks.scan_all_sources")
        logger.info("Queued scan_all_sources task id=%s", result.id)
    except Exception as exc:
        logger.error("Failed to queue scan_all_sources: %s", exc)


def _trigger_fan_out() -> None:
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.surfacing_tasks.fan_out_sources_to_all")
    except Exception as exc:
        logger.warning("Failed to trigger fan_out: %s", exc)
