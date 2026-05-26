"""Grant source management endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.source import Source, SourceRun
from app.models.user import User, UserRole
from app.routers.auth import get_current_user
from app.auth.permissions import require_org_admin

router = APIRouter()

class SourceCreate(BaseModel):
    name: str
    url: Optional[str] = None
    source_type: str = "html_static"
    category: Optional[str] = None
    refresh_frequency: str = "weekly"
    relevant_themes: list[str] = []
    relevant_geographies: list[str] = []
    scraper_config: dict = {}
    is_high_priority: bool = False

class SourceUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    refresh_frequency: Optional[str] = None
    is_high_priority: Optional[bool] = None
    scraper_config: Optional[dict] = None

@router.get("/")
async def list_sources(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Source))
    sources = result.scalars().all()
    return [{
        "id": s.id, "name": s.name, "url": s.url, "source_type": s.source_type,
        "status": s.status, "last_checked": str(s.last_checked) if s.last_checked else None,
        "opportunities_discovered": s.opportunities_discovered, "category": s.category,
        "refresh_frequency": s.refresh_frequency, "is_high_priority": s.is_high_priority,
    } for s in sources]

@router.post("/", status_code=201, dependencies=[Depends(require_org_admin())])
async def create_source(data: SourceCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    source = Source(id=str(uuid.uuid4()), owner_id=current_user.id, **data.model_dump())
    db.add(source)
    await db.commit()
    return {"id": source.id}

@router.post("/run-all", dependencies=[Depends(require_org_admin())])
async def run_all_sources(bg: BackgroundTasks, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Queue an immediate scan of all active sources."""
    result = await db.execute(select(Source).where(Source.status == "active"))
    active_sources = result.scalars().all()
    count = len(active_sources)
    bg.add_task(_trigger_all_sources_scan)
    return {"message": f"Scan queued for {count} active source{'s' if count != 1 else ''}", "queued": count}

@router.patch("/{source_id}", dependencies=[Depends(require_org_admin())])
async def update_source(source_id: str, data: SourceUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(source, k, v)
    await db.commit()
    return {"id": source.id}

@router.post("/{source_id}/run-now", dependencies=[Depends(require_org_admin())])
async def run_source_now(source_id: str, bg: BackgroundTasks, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    bg.add_task(_trigger_source_scan, source_id)
    return {"message": f"Scan triggered for {source.name}"}

@router.post("/{source_id}/toggle", dependencies=[Depends(require_org_admin())])
async def toggle_source(source_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Toggle a source between active and paused."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    source.status = "paused" if source.status == "active" else "active"
    await db.commit()
    return {"id": source.id, "status": source.status}

@router.delete("/{source_id}", status_code=204, dependencies=[Depends(require_org_admin())])
async def delete_source(source_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Permanently delete a source and its run history."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    await db.delete(source)
    await db.commit()

@router.get("/{source_id}/runs")
async def get_source_runs(source_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(SourceRun).where(SourceRun.source_id == source_id))
    runs = result.scalars().all()
    return [{c.name: str(getattr(r, c.name)) if c.name in ["started_at","ended_at"] else getattr(r, c.name) for c in r.__table__.columns} for r in runs]

async def _trigger_source_scan(source_id: str):
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.discovery_tasks.scan_source", args=[source_id])

async def _trigger_all_sources_scan():
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.discovery_tasks.scan_all_sources")
