"""Grant source management endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.source import Source, SourceRun
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import require_org_admin

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


@router.post("/run-all", dependencies=[Depends(require_org_admin())])
async def run_all_sources(
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Queue an immediate scan of all active sources."""
    result = await db.execute(select(Source).where(Source.status == "active"))
    count = len(result.scalars().all())
    bg.add_task(_trigger_all_sources_scan)
    return {"message": f"Scan queued for {count} active source{'s' if count != 1 else ''}", "queued": count}


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
            "duplicates": r.duplicates,
            "records_found": r.records_found,
            "errors": r.errors or [],
            "log_summary": r.log_summary,
        }
        for r in runs
    ]


# ── Internal helpers (sync — called from BackgroundTasks) ─────────────────────

def _trigger_source_scan(source_id: str) -> None:
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.discovery_tasks.scan_source", args=[source_id])
    except Exception:
        pass


def _trigger_all_sources_scan() -> None:
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.discovery_tasks.scan_all_sources")
    except Exception:
        pass


def _trigger_fan_out() -> None:
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.surfacing_tasks.fan_out_sources_to_all")
    except Exception:
        pass
