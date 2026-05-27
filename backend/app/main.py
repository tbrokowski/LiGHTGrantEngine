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
    notifications, analytics, admin, partners, organizations,
)
from app.routers import grant_workspace
from app.routers import grant_writing

settings = get_settings()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "LiGHT Grant System starting",
        model=settings.ai.model,
        env=settings.environment,
        base_url=settings.base_url,
    )
    try:
        from app.services.grant_bootstrap import run_full_bootstrap
        result = run_full_bootstrap()
        logger.info(
            "Grant pool bootstrap complete",
            sources_seeded=result.get("sources_seeded", 0),
            opportunities_seeded=result.get("opportunities_seeded", 0),
        )
    except Exception as exc:
        logger.warning("Grant pool bootstrap skipped or failed", error=str(exc))
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
_cors_origins = list({
    settings.base_url,
    "http://localhost:3000",
    "https://lightgrantengine.up.railway.app",
})
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
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
app.include_router(partners.router,      prefix=f"{API}/partners",      tags=["partners"])
app.include_router(grant_workspace.router,         prefix=f"{API}/grants",  tags=["grant-workspace"])
app.include_router(grant_writing.status_router,    prefix=f"{API}/grants",  tags=["grant-writing"])
app.include_router(grant_writing.router,           prefix=f"{API}/grants",  tags=["grant-writing"])
app.include_router(organizations.router,     prefix=f"{API}/organizations",  tags=["organizations"])


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.app_name, "model": settings.ai.model}
