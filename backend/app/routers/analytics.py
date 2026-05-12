"""Analytics and reporting endpoints."""
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.opportunity import Opportunity
from app.models.active_grant import ActiveGrant
from app.models.task import Task
from app.models.archive import GrantArchive
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

@router.get("/dashboard")
async def dashboard_stats(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    week_ago = today - timedelta(days=7)
    thirty_days = today + timedelta(days=30)

    new_this_week = (await db.execute(
        select(func.count()).select_from(Opportunity).where(Opportunity.date_discovered >= week_ago)
    )).scalar()

    high_fit_pending = (await db.execute(
        select(func.count()).select_from(Opportunity).where(
            Opportunity.fit_score >= 70, Opportunity.status.in_(["new","needs_review","in_review"])
        )
    )).scalar()

    active_grants_count = (await db.execute(
        select(func.count()).select_from(ActiveGrant).where(ActiveGrant.status.notin_(["closed","withdrawn","archived"]))
    )).scalar()

    due_30 = (await db.execute(
        select(func.count()).select_from(ActiveGrant).where(
            and_(ActiveGrant.external_deadline <= thirty_days, ActiveGrant.external_deadline >= today)
        )
    )).scalar()

    overdue_tasks = (await db.execute(
        select(func.count()).select_from(Task).where(and_(Task.due_date < today, Task.status.notin_(["complete","dropped"])))
    )).scalar()

    archived_count = (await db.execute(select(func.count()).select_from(GrantArchive))).scalar()

    return {
        "new_opportunities_this_week": new_this_week,
        "high_fit_pending_review": high_fit_pending,
        "active_grants": active_grants_count,
        "grants_due_within_30_days": due_30,
        "overdue_tasks": overdue_tasks,
        "archived_grants": archived_count,
    }

@router.get("/pipeline")
async def pipeline_report(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    status_counts = (await db.execute(
        select(ActiveGrant.status, func.count()).group_by(ActiveGrant.status)
    )).all()
    return {"by_status": {s: c for s, c in status_counts}}

@router.get("/success-rate")
async def success_rate(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    by_funder = (await db.execute(
        select(GrantArchive.funder, GrantArchive.outcome, func.count()).group_by(GrantArchive.funder, GrantArchive.outcome)
    )).all()
    results = {}
    for funder, outcome, count in by_funder:
        if funder not in results:
            results[funder] = {}
        results[funder][outcome or "unknown"] = count
    return results
