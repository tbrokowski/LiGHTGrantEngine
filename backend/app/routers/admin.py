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
