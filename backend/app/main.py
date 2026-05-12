"""
LiGHT Grant System — FastAPI application entry point.
"""
import structlog
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    auth, users, sources, opportunities, grants,
    tasks, documents, archive, ai_assistant,
    notifications, analytics, admin,
)

settings = get_settings()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("LiGHT Grant System starting", model=settings.ai.model, env=settings.environment)
    yield
    logger.info("LiGHT Grant System shutting down")


app = FastAPI(
    title=settings.app_name,
    description="Dynamic Grant Intelligence, Tracking, and Proposal Automation Hub",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.base_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
API = "/api/v1"
app.include_router(auth.router,          prefix=f"{API}/auth",          tags=["auth"])
app.include_router(users.router,         prefix=f"{API}/users",         tags=["users"])
app.include_router(sources.router,       prefix=f"{API}/sources",       tags=["sources"])
app.include_router(opportunities.router, prefix=f"{API}/opportunities", tags=["opportunities"])
app.include_router(grants.router,        prefix=f"{API}/grants",        tags=["grants"])
app.include_router(tasks.router,         prefix=f"{API}/tasks",         tags=["tasks"])
app.include_router(documents.router,     prefix=f"{API}/documents",     tags=["documents"])
app.include_router(archive.router,       prefix=f"{API}/archive",       tags=["archive"])
app.include_router(ai_assistant.router,  prefix=f"{API}/ai",            tags=["ai"])
app.include_router(notifications.router, prefix=f"{API}/notifications", tags=["notifications"])
app.include_router(analytics.router,     prefix=f"{API}/analytics",     tags=["analytics"])
app.include_router(admin.router,         prefix=f"{API}/admin",         tags=["admin"])


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.app_name, "model": settings.ai.model}
