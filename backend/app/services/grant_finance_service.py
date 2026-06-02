"""Shared finance ledger calculations and helpers."""
from __future__ import annotations

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.grant_ledger import FundRequest, FundRequestStatus, Expenditure, LedgerCategory


COMMITTED_STATUSES = (
    FundRequestStatus.PENDING.value,
    FundRequestStatus.UNDER_REVIEW.value,
    FundRequestStatus.APPROVED.value,
)


async def category_balances(db: AsyncSession, ledger_id: str, category_ids: list[str]) -> dict[str, dict]:
    """Return spent and committed amounts per category id."""
    if not category_ids:
        return {}

    spent_q = (
        select(Expenditure.category_id, func.coalesce(func.sum(Expenditure.amount), 0))
        .where(Expenditure.category_id.in_(category_ids))
        .group_by(Expenditure.category_id)
    )
    spent_rows = (await db.execute(spent_q)).all()
    spent_map = {r[0]: float(r[1]) for r in spent_rows if r[0]}

    committed_q = (
        select(FundRequest.category_id, func.coalesce(func.sum(FundRequest.amount), 0))
        .where(
            FundRequest.category_id.in_(category_ids),
            FundRequest.status.in_(COMMITTED_STATUSES),
        )
        .group_by(FundRequest.category_id)
    )
    committed_rows = (await db.execute(committed_q)).all()
    committed_map = {r[0]: float(r[1]) for r in committed_rows if r[0]}

    out: dict[str, dict] = {}
    for cid in category_ids:
        approved = 0.0  # filled by caller from category row
        spent = spent_map.get(cid, 0.0)
        committed = committed_map.get(cid, 0.0)
        out[cid] = {
            "spent_amount": spent,
            "committed_amount": committed,
            "available_amount": None,  # set after approved known
        }
    return out


def enrich_category(cat: LedgerCategory, balances: dict) -> dict:
    b = balances.get(cat.id, {"spent_amount": 0, "committed_amount": 0})
    approved = float(cat.approved_amount or 0)
    spent = b["spent_amount"]
    committed = b["committed_amount"]
    available = approved - spent - committed
    pct = (spent + committed) / approved * 100 if approved > 0 else 0
    return {
        "id": cat.id,
        "ledger_id": cat.ledger_id,
        "name": cat.name,
        "approved_amount": approved,
        "description": cat.description,
        "display_order": cat.display_order,
        "spent_amount": spent,
        "committed_amount": committed,
        "available_amount": available,
        "utilization_pct": round(pct, 1),
    }
