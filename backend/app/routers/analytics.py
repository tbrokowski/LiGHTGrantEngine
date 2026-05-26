"""Analytics and reporting endpoints — scoped to the current user's institution."""
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.opportunity import Opportunity
from app.models.active_grant import ActiveGrant
from app.models.task import Task
from app.models.archive import GrantArchive
from app.models.grant_member import GrantMember, GrantMemberStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import is_org_admin

router = APIRouter()

@router.get("/dashboard")
async def dashboard_stats(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    week_ago = today - timedelta(days=7)
    thirty_days = today + timedelta(days=30)
    inst_id = current_user.institution_id

    new_this_week = (await db.execute(
        select(func.count()).select_from(Opportunity).where(Opportunity.date_discovered >= week_ago)
    )).scalar()

    high_fit_pending = (await db.execute(
        select(func.count()).select_from(Opportunity).where(
            Opportunity.fit_score >= 70, Opportunity.status.in_(["new","needs_review","in_review"])
        )
    )).scalar()

    # Scope grant queries to institution
    grant_base = select(func.count()).select_from(ActiveGrant)
    if inst_id and not is_org_admin(current_user):
        member_grant_ids = (await db.execute(
            select(GrantMember.grant_id).where(
                GrantMember.user_id == current_user.id,
                GrantMember.status == GrantMemberStatus.ACCEPTED,
            )
        )).scalars().all()
        grant_filter = ActiveGrant.id.in_(member_grant_ids)
    else:
        grant_filter = ActiveGrant.institution_id == inst_id if inst_id else True

    active_grants_count = (await db.execute(
        grant_base.where(ActiveGrant.status.notin_(["closed","withdrawn","archived"]), grant_filter)
    )).scalar()

    due_30 = (await db.execute(
        select(func.count()).select_from(ActiveGrant).where(
            and_(ActiveGrant.external_deadline <= thirty_days, ActiveGrant.external_deadline >= today, grant_filter)
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
    inst_id = current_user.institution_id
    q = select(ActiveGrant.status, func.count()).group_by(ActiveGrant.status)
    if inst_id:
        q = q.where(ActiveGrant.institution_id == inst_id)
    status_counts = (await db.execute(q)).all()
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
