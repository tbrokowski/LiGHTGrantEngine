"""Org-level finance module — portfolio and cross-grant fund requests."""
from fastapi import APIRouter, Depends
from sqlalchemy import select, desc, or_, cast, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.active_grant import ActiveGrant
from app.models.grant_ledger import FundRequest, FundRequestStatus
from app.models.user import User
from app.models.grant_member import GrantMember, GrantMemberStatus
from app.routers.auth import get_current_user
from app.auth.permissions import is_org_admin, has_module_permission, require_finance_module
from app.services.grant_finance_summary import get_finance_summary

router = APIRouter(dependencies=[Depends(require_finance_module())])


async def _visible_active_grants(db: AsyncSession, current_user: User) -> list[ActiveGrant]:
    """Active/awarded grants visible to this user in the finance module."""
    seen: set[str] = set()
    grants_out: list[ActiveGrant] = []

    personal_q = select(ActiveGrant).where(
        ActiveGrant.is_personal.is_(True),
        ActiveGrant.created_by_id == current_user.id,
        ActiveGrant.grant_stage.in_(["active", "awarded"]),
    )
    for g in (await db.execute(personal_q.order_by(desc(ActiveGrant.updated_at)))).scalars().all():
        if g.id not in seen:
            seen.add(g.id)
            grants_out.append(g)

    if current_user.institution_id:
        q = select(ActiveGrant).where(
            ActiveGrant.institution_id == current_user.institution_id,
            ActiveGrant.is_personal.is_(False),
            ActiveGrant.grant_stage.in_(["active", "awarded"]),
        )
        if not is_org_admin(current_user) and not has_module_permission(current_user, "can_view_grants"):
            member_grant_ids_q = select(GrantMember.grant_id).where(
                GrantMember.user_id == current_user.id,
                GrantMember.status == GrantMemberStatus.ACCEPTED,
            )
            member_grant_ids = (await db.execute(member_grant_ids_q)).scalars().all()
            q = q.where(
                or_(
                    ActiveGrant.internal_lead_id == current_user.id,
                    ActiveGrant.created_by_id == current_user.id,
                    ActiveGrant.id.in_(member_grant_ids),
                    ActiveGrant.proposal_team.cast(String).contains(current_user.id),
                )
            )
        for g in (await db.execute(q.order_by(desc(ActiveGrant.updated_at)))).scalars().all():
            if g.id not in seen:
                seen.add(g.id)
                grants_out.append(g)

    return grants_out


@router.get("/portfolio")
async def finance_portfolio(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List active/awarded grants with finance summary for the portfolio hub."""
    grants_out: list[dict] = []

    for grant in await _visible_active_grants(db, current_user):
        finance = await get_finance_summary(grant.id, db)
        grants_out.append({
            "id": grant.id,
            "title": grant.title,
            "funder": grant.funder,
            "pi_name": grant.pi_name,
            "award_amount": grant.award_amount,
            "currency": grant.currency,
            "external_deadline": str(grant.external_deadline) if grant.external_deadline else None,
            "decision_at": grant.decision_at.isoformat() if grant.decision_at else None,
            "color": grant.color,
            "finance": finance,
        })

    total_awarded = sum(g["award_amount"] or 0 for g in grants_out)
    total_available = sum(
        (g["finance"].get("total_available") or 0)
        for g in grants_out
        if g["finance"].get("enabled")
    )
    at_risk = sum(
        1 for g in grants_out
        if g["finance"].get("status") in ("at_risk", "over_budget")
    )
    pending_requests = sum(g["finance"].get("pending_requests") or 0 for g in grants_out)

    return {
        "grants": grants_out,
        "summary": {
            "grant_count": len(grants_out),
            "total_awarded": total_awarded,
            "total_available": total_available,
            "at_risk_count": at_risk,
            "pending_requests": pending_requests,
        },
    }


@router.get("/fund-requests")
async def list_org_fund_requests(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All fund requests across visible active grants."""
    grant_list = await _visible_active_grants(db, current_user)
    grant_ids = [g.id for g in grant_list]
    grant_titles = {g.id: g.title for g in grant_list}

    if not grant_ids:
        return []

    q = select(FundRequest).where(FundRequest.grant_id.in_(grant_ids)).order_by(FundRequest.created_at.desc())
    if status == "all":
        pass
    elif status:
        q = q.where(FundRequest.status == status)
    else:
        q = q.where(
            FundRequest.status.in_([
                FundRequestStatus.PENDING.value,
                FundRequestStatus.UNDER_REVIEW.value,
                FundRequestStatus.APPROVED.value,
            ])
        )

    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": fr.id,
            "grant_id": fr.grant_id,
            "grant_title": grant_titles.get(fr.grant_id),
            "category_id": fr.category_id,
            "title": fr.title,
            "description": fr.description,
            "vendor": fr.vendor,
            "amount": fr.amount,
            "currency": fr.currency,
            "status": fr.status,
            "created_at": fr.created_at.isoformat() if fr.created_at else None,
        }
        for fr in rows
    ]
