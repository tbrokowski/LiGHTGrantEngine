"""Compact finance summary for workspace overview (avoids router circular imports)."""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.grant_ledger import (
    GrantLedger,
    LedgerCategory,
    FundRequest,
    FundRequestStatus,
)
from app.services.grant_finance_service import category_balances

COMMITTED = (
    FundRequestStatus.PENDING.value,
    FundRequestStatus.UNDER_REVIEW.value,
    FundRequestStatus.APPROVED.value,
)


async def get_finance_summary(grant_id: str, db: AsyncSession) -> dict:
    ledger_result = await db.execute(select(GrantLedger).where(GrantLedger.grant_id == grant_id))
    ledger = ledger_result.scalar_one_or_none()
    if not ledger:
        return {"enabled": True, "status": "not_setup"}

    cats_result = await db.execute(
        select(LedgerCategory).where(LedgerCategory.ledger_id == ledger.id)
    )
    categories = cats_result.scalars().all()
    if not categories:
        return {"enabled": True, "status": "not_setup", "currency": ledger.currency}

    cat_ids = [c.id for c in categories]
    balances = await category_balances(db, ledger.id, cat_ids)
    total_approved = sum(float(c.approved_amount or 0) for c in categories)
    total_spent = sum(balances.get(c.id, {}).get("spent_amount", 0) for c in categories)
    total_committed = sum(balances.get(c.id, {}).get("committed_amount", 0) for c in categories)
    util = (total_spent + total_committed) / total_approved * 100 if total_approved else 0

    if util >= 100:
        status = "over_budget"
    elif util >= 80:
        status = "at_risk"
    else:
        status = "on_track"

    pending = await db.execute(
        select(func.count(FundRequest.id)).where(
            FundRequest.grant_id == grant_id,
            FundRequest.status.in_([
                FundRequestStatus.PENDING.value,
                FundRequestStatus.UNDER_REVIEW.value,
            ]),
        )
    )
    pending_count = pending.scalar() or 0

    return {
        "enabled": True,
        "status": status,
        "utilization_pct": round(util, 1),
        "total_available": total_approved - total_spent - total_committed,
        "pending_requests": pending_count,
        "currency": ledger.currency,
    }
