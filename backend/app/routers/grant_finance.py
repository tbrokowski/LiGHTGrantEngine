"""Grant financial management — ledger, fund requests, expenditures, AI, Slack config."""
import csv
import io
import json
import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import get_settings
from app.models.active_grant import ActiveGrant
from app.models.grant_ledger import (
    GrantLedger,
    LedgerCategory,
    FundRequest,
    Expenditure,
    FundRequestStatus,
)
from app.models.slack_config import SlackGrantConfig
from app.models.budget_tracker import BudgetTracker
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import grant_access
from app.routers.grant_workspace import _get_grant_or_404, log_activity, _serialize
from app.services.grant_finance_service import category_balances, enrich_category
from app.services import finance_ai

router = APIRouter(dependencies=[Depends(grant_access())])


def _require_active_grant(grant: ActiveGrant) -> None:
    if grant.grant_stage not in ("active", "awarded"):
        raise HTTPException(400, "Financial management is only available for active grants")


async def _get_or_create_ledger(grant_id: str, db: AsyncSession, grant: ActiveGrant) -> GrantLedger:
    result = await db.execute(select(GrantLedger).where(GrantLedger.grant_id == grant_id))
    ledger = result.scalar_one_or_none()
    if ledger:
        return ledger
    ledger = GrantLedger(
        id=str(uuid.uuid4()),
        grant_id=grant_id,
        total_awarded=grant.award_amount,
        currency=grant.currency or "USD",
    )
    db.add(ledger)
    await db.flush()
    return ledger


# ── Schemas ────────────────────────────────────────────────────────────────────

class LedgerUpdate(BaseModel):
    total_awarded: Optional[float] = None
    currency: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None


class CategoryCreate(BaseModel):
    name: str
    approved_amount: float = 0
    description: Optional[str] = None
    display_order: int = 0


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    approved_amount: Optional[float] = None
    description: Optional[str] = None
    display_order: Optional[int] = None


class FundRequestCreate(BaseModel):
    title: str
    description: Optional[str] = None
    vendor: Optional[str] = None
    amount: float
    currency: Optional[str] = None
    category_id: Optional[str] = None
    attachments: list = []


class FundRequestUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    category_id: Optional[str] = None
    status: Optional[str] = None
    rejection_reason: Optional[str] = None


class ExpenditureCreate(BaseModel):
    amount: float
    currency: Optional[str] = None
    category_id: Optional[str] = None
    fund_request_id: Optional[str] = None
    expense_date: Optional[date] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    receipt_url: Optional[str] = None


class SlackConfigUpdate(BaseModel):
    slack_channel_id: str
    slack_channel_name: Optional[str] = None
    slack_team_id: Optional[str] = None
    is_active: bool = True


class ImportCategoriesBody(BaseModel):
    categories: list[CategoryCreate]


# ── Ledger ─────────────────────────────────────────────────────────────────────

@router.get("/{grant_id}/finance/ledger")
async def get_ledger(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    ledger = await _get_or_create_ledger(grant_id, db, grant)
    cats_result = await db.execute(
        select(LedgerCategory)
        .where(LedgerCategory.ledger_id == ledger.id)
        .order_by(LedgerCategory.display_order, LedgerCategory.name)
    )
    categories = cats_result.scalars().all()
    cat_ids = [c.id for c in categories]
    balances = await category_balances(db, ledger.id, cat_ids)
    cat_dicts = [enrich_category(c, balances) for c in categories]

    total_approved = sum(c["approved_amount"] for c in cat_dicts)
    total_spent = sum(c["spent_amount"] for c in cat_dicts)
    total_committed = sum(c["committed_amount"] for c in cat_dicts)

    return {
        "ledger": _serialize(ledger, date_fields=["start_date", "end_date"], dt_fields=["created_at", "updated_at"]),
        "categories": cat_dicts,
        "summary": {
            "total_approved": total_approved,
            "total_spent": total_spent,
            "total_committed": total_committed,
            "total_available": total_approved - total_spent - total_committed,
            "utilization_pct": round((total_spent + total_committed) / total_approved * 100, 1) if total_approved else 0,
        },
    }


@router.patch("/{grant_id}/finance/ledger")
async def update_ledger(
    grant_id: str,
    data: LedgerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    ledger = await _get_or_create_ledger(grant_id, db, grant)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(ledger, k, v)
    await log_activity(db, grant_id, "finance_ledger_updated", current_user.id, "grant_ledger", ledger.id)
    await db.commit()
    return await get_ledger(grant_id, db, current_user)


@router.post("/{grant_id}/finance/ledger/categories")
async def create_category(
    grant_id: str,
    data: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    ledger = await _get_or_create_ledger(grant_id, db, grant)
    cat = LedgerCategory(
        id=str(uuid.uuid4()),
        ledger_id=ledger.id,
        name=data.name,
        approved_amount=data.approved_amount,
        description=data.description,
        display_order=data.display_order,
    )
    db.add(cat)
    await log_activity(db, grant_id, "finance_category_created", current_user.id, "ledger_category", cat.id)
    await db.commit()
    return enrich_category(cat, await category_balances(db, ledger.id, [cat.id]))


@router.patch("/{grant_id}/finance/ledger/categories/{category_id}")
async def update_category(
    grant_id: str,
    category_id: str,
    data: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    ledger = await _get_or_create_ledger(grant_id, db, grant)
    result = await db.execute(
        select(LedgerCategory).where(
            LedgerCategory.id == category_id,
            LedgerCategory.ledger_id == ledger.id,
        )
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(cat, k, v)
    await db.commit()
    balances = await category_balances(db, ledger.id, [cat.id])
    return enrich_category(cat, balances)


@router.delete("/{grant_id}/finance/ledger/categories/{category_id}")
async def delete_category(
    grant_id: str,
    category_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    ledger = await _get_or_create_ledger(grant_id, db, grant)
    result = await db.execute(
        select(LedgerCategory).where(
            LedgerCategory.id == category_id,
            LedgerCategory.ledger_id == ledger.id,
        )
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")
    await db.delete(cat)
    await db.commit()
    return {"ok": True}


@router.post("/{grant_id}/finance/ledger/import-spreadsheet")
async def import_ledger_spreadsheet(
    grant_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    """Parse budget spreadsheet and create ledger categories (grouped by category)."""
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"xlsx", "xls", "csv"}:
        raise HTTPException(400, "Use XLSX or CSV")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10 MB)")

    from app.services.budget_parser import parse_budget_file

    try:
        items = parse_budget_file(content, file.filename or "budget.xlsx")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    ledger = await _get_or_create_ledger(grant_id, db, grant)
    # Aggregate by category
    agg: dict[str, float] = {}
    for item in items:
        cat_name = (item.get("category") or "Other").strip() or "Other"
        total = item.get("total")
        if total is None:
            qty = item.get("quantity") or 1
            unit = item.get("unit_cost") or 0
            total = float(qty) * float(unit)
        agg[cat_name] = agg.get(cat_name, 0) + float(total or 0)

    order = 0
    created = []
    for name, amount in sorted(agg.items(), key=lambda x: -x[1]):
        cat = LedgerCategory(
            id=str(uuid.uuid4()),
            ledger_id=ledger.id,
            name=name,
            approved_amount=amount,
            display_order=order,
        )
        db.add(cat)
        created.append({"name": name, "approved_amount": amount})
        order += 1

    if agg:
        ledger.total_awarded = sum(agg.values())
    await log_activity(db, grant_id, "finance_ledger_imported", current_user.id, "grant_ledger", ledger.id)
    await db.commit()
    return {"categories_created": len(created), "categories": created, "total": sum(agg.values())}


@router.post("/{grant_id}/finance/ledger/import-categories")
async def import_categories_json(
    grant_id: str,
    body: ImportCategoriesBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    ledger = await _get_or_create_ledger(grant_id, db, grant)
    for i, c in enumerate(body.categories):
        db.add(LedgerCategory(
            id=str(uuid.uuid4()),
            ledger_id=ledger.id,
            name=c.name,
            approved_amount=c.approved_amount,
            description=c.description,
            display_order=c.display_order if c.display_order else i,
        ))
    await db.commit()
    return await get_ledger(grant_id, db, current_user)


@router.get("/{grant_id}/finance/export")
async def export_budget_vs_actual(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = await get_ledger(grant_id, db, current_user)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Category", "Approved", "Committed", "Spent", "Available", "Utilization %"])
    for c in data["categories"]:
        writer.writerow([
            c["name"],
            c["approved_amount"],
            c["committed_amount"],
            c["spent_amount"],
            c["available_amount"],
            c["utilization_pct"],
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="budget_vs_actual_{grant_id[:8]}.csv"'},
    )


# ── Fund requests ──────────────────────────────────────────────────────────────

def _fund_request_dict(fr: FundRequest) -> dict:
    return _serialize(fr, dt_fields=["created_at", "updated_at", "approved_at"])


async def _check_category_capacity(
    db: AsyncSession,
    category_id: str | None,
    amount: float,
    exclude_request_id: str | None = None,
) -> None:
    if not category_id:
        return
    cat_result = await db.execute(select(LedgerCategory).where(LedgerCategory.id == category_id))
    cat = cat_result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")
    balances = await category_balances(db, cat.ledger_id, [category_id])
    b = balances.get(category_id, {"spent_amount": 0, "committed_amount": 0})
    available = float(cat.approved_amount) - b["spent_amount"] - b["committed_amount"]
    if exclude_request_id:
        req = await db.execute(select(FundRequest).where(FundRequest.id == exclude_request_id))
        existing = req.scalar_one_or_none()
        if existing and existing.category_id == category_id and existing.status in (
            FundRequestStatus.PENDING.value,
            FundRequestStatus.UNDER_REVIEW.value,
            FundRequestStatus.APPROVED.value,
        ):
            available += float(existing.amount)
    if amount > available + 0.01:
        raise HTTPException(400, f"Insufficient budget in category '{cat.name}'. Available: {available:,.2f}")


@router.get("/{grant_id}/finance/fund-requests")
async def list_fund_requests(
    grant_id: str,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    q = select(FundRequest).where(FundRequest.grant_id == grant_id).order_by(FundRequest.created_at.desc())
    if status:
        q = q.where(FundRequest.status == status)
    result = await db.execute(q)
    return [_fund_request_dict(fr) for fr in result.scalars().all()]


@router.post("/{grant_id}/finance/fund-requests")
async def create_fund_request(
    grant_id: str,
    data: FundRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    currency = data.currency or grant.currency or "USD"
    await _check_category_capacity(db, data.category_id, data.amount)

    fr = FundRequest(
        id=str(uuid.uuid4()),
        grant_id=grant_id,
        category_id=data.category_id,
        requested_by_id=current_user.id,
        title=data.title,
        description=data.description,
        vendor=data.vendor,
        amount=data.amount,
        currency=currency,
        status=FundRequestStatus.PENDING.value,
        attachments=data.attachments or [],
    )
    db.add(fr)
    await log_activity(db, grant_id, "fund_request_created", current_user.id, "fund_request", fr.id, data.title)
    await db.flush()

    # Slack notification
    await _notify_slack_fund_request(db, grant, fr, current_user)

    await db.commit()
    return _fund_request_dict(fr)


async def _notify_slack_fund_request(db: AsyncSession, grant: ActiveGrant, fr: FundRequest, user: User) -> None:
    cfg_result = await db.execute(
        select(SlackGrantConfig).where(
            SlackGrantConfig.grant_id == grant.id,
            SlackGrantConfig.is_active == True,  # noqa: E712
        )
    )
    cfg = cfg_result.scalar_one_or_none()
    if not cfg:
        return
    cat_name = None
    if fr.category_id:
        cr = await db.execute(select(LedgerCategory).where(LedgerCategory.id == fr.category_id))
        cat = cr.scalar_one_or_none()
        cat_name = cat.name if cat else None

    settings = get_settings()
    from app.services.slack_client import (
        build_fund_request_blocks,
        build_fund_request_text,
        post_message,
    )
    blocks = build_fund_request_blocks(
        fr.id,
        fr.title,
        fr.amount,
        fr.currency,
        cat_name,
        fr.vendor,
        fr.description,
        user.name or user.email,
        fr.status,
        grant.title,
        settings.base_url,
        grant.id,
    )
    text = build_fund_request_text(fr.title, fr.amount, fr.currency, fr.status)
    try:
        token = cfg.slack_bot_token or settings.slack_bot_token
        resp = await post_message(cfg.slack_channel_id, blocks, text, bot_token=token)
        fr.slack_message_ts = resp.get("ts")
        fr.slack_channel_id = cfg.slack_channel_id
    except Exception:
        pass


@router.patch("/{grant_id}/finance/fund-requests/{request_id}")
async def update_fund_request(
    grant_id: str,
    request_id: str,
    data: FundRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(FundRequest).where(FundRequest.id == request_id, FundRequest.grant_id == grant_id)
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise HTTPException(404, "Fund request not found")

    updates = data.model_dump(exclude_none=True)
    new_status = updates.pop("status", None)
    new_amount = updates.get("amount", fr.amount)
    new_cat = updates.get("category_id", fr.category_id)

    if new_amount != fr.amount or new_cat != fr.category_id:
        await _check_category_capacity(db, new_cat, new_amount, exclude_request_id=request_id)

    for k, v in updates.items():
        setattr(fr, k, v)

    if new_status:
        await _transition_fund_request(db, grant, fr, new_status, current_user, data.rejection_reason)

    await db.commit()
    return _fund_request_dict(fr)


async def _transition_fund_request(
    db: AsyncSession,
    grant: ActiveGrant,
    fr: FundRequest,
    new_status: str,
    user: User,
    rejection_reason: str | None = None,
) -> None:
    valid = {s.value for s in FundRequestStatus}
    if new_status not in valid:
        raise HTTPException(400, f"Invalid status: {new_status}")

    if new_status == FundRequestStatus.APPROVED.value:
        await _check_category_capacity(db, fr.category_id, fr.amount, exclude_request_id=fr.id)
        fr.approved_by_id = user.id
        fr.approved_at = datetime.utcnow()
        fr.rejection_reason = None
    elif new_status == FundRequestStatus.REJECTED.value:
        fr.rejection_reason = rejection_reason
        fr.approved_by_id = None
        fr.approved_at = None
    elif new_status == FundRequestStatus.PAID.value:
        if fr.status != FundRequestStatus.APPROVED.value:
            raise HTTPException(400, "Only approved requests can be marked paid")
        exp = Expenditure(
            id=str(uuid.uuid4()),
            grant_id=grant.id,
            category_id=fr.category_id,
            fund_request_id=fr.id,
            amount=fr.amount,
            currency=fr.currency,
            expense_date=date.today(),
            vendor=fr.vendor,
            description=fr.title,
            recorded_by_id=user.id,
        )
        db.add(exp)

    fr.status = new_status
    await log_activity(db, grant.id, f"fund_request_{new_status}", user.id, "fund_request", fr.id)
    await _update_slack_message(db, grant, fr, user)


async def _update_slack_message(db: AsyncSession, grant: ActiveGrant, fr: FundRequest, user: User) -> None:
    if not fr.slack_message_ts or not fr.slack_channel_id:
        return
    cat_name = None
    if fr.category_id:
        cr = await db.execute(select(LedgerCategory).where(LedgerCategory.id == fr.category_id))
        cat = cr.scalar_one_or_none()
        cat_name = cat.name if cat else None
    settings = get_settings()
    from app.services.slack_client import build_fund_request_blocks, build_fund_request_text, update_message

    cfg_result = await db.execute(select(SlackGrantConfig).where(SlackGrantConfig.grant_id == grant.id))
    cfg = cfg_result.scalar_one_or_none()
    token = (cfg.slack_bot_token if cfg else None) or settings.slack_bot_token
    blocks = build_fund_request_blocks(
        fr.id, fr.title, fr.amount, fr.currency, cat_name, fr.vendor, fr.description,
        user.name or user.email, fr.status, grant.title, settings.base_url, grant.id,
    )
    # Remove action buttons if terminal state
    if fr.status in (FundRequestStatus.APPROVED.value, FundRequestStatus.REJECTED.value, FundRequestStatus.PAID.value, FundRequestStatus.CANCELLED.value):
        blocks = [b for b in blocks if b.get("type") != "actions"]
    text = build_fund_request_text(fr.title, fr.amount, fr.currency, fr.status)
    try:
        await update_message(fr.slack_channel_id, fr.slack_message_ts, blocks, text, bot_token=token)
    except Exception:
        pass


@router.post("/{grant_id}/finance/fund-requests/{request_id}/approve")
async def approve_fund_request(
    grant_id: str,
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    return await update_fund_request(
        grant_id,
        request_id,
        FundRequestUpdate(status=FundRequestStatus.APPROVED.value),
        db=db,
        current_user=current_user,
        _edit=_edit,
    )


class RejectBody(BaseModel):
    rejection_reason: Optional[str] = None


@router.post("/{grant_id}/finance/fund-requests/{request_id}/reject")
async def reject_fund_request(
    grant_id: str,
    request_id: str,
    body: RejectBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    return await update_fund_request(
        grant_id,
        request_id,
        FundRequestUpdate(status=FundRequestStatus.REJECTED.value, rejection_reason=body.rejection_reason),
        db=db,
        current_user=current_user,
        _edit=_edit,
    )


# ── Expenditures ───────────────────────────────────────────────────────────────

@router.get("/{grant_id}/finance/expenditures")
async def list_expenditures(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(
        select(Expenditure).where(Expenditure.grant_id == grant_id).order_by(Expenditure.expense_date.desc())
    )
    return [_serialize(e, date_fields=["expense_date"], dt_fields=["created_at", "updated_at"]) for e in result.scalars().all()]


@router.post("/{grant_id}/finance/expenditures")
async def create_expenditure(
    grant_id: str,
    data: ExpenditureCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    if data.category_id:
        await _check_category_capacity(db, data.category_id, data.amount)

    exp = Expenditure(
        id=str(uuid.uuid4()),
        grant_id=grant_id,
        category_id=data.category_id,
        fund_request_id=data.fund_request_id,
        amount=data.amount,
        currency=data.currency or grant.currency or "USD",
        expense_date=data.expense_date or date.today(),
        vendor=data.vendor,
        description=data.description,
        receipt_url=data.receipt_url,
        recorded_by_id=current_user.id,
    )
    db.add(exp)
    await log_activity(db, grant_id, "expenditure_recorded", current_user.id, "expenditure", exp.id)
    await db.commit()
    return _serialize(exp, date_fields=["expense_date"], dt_fields=["created_at", "updated_at"])


@router.delete("/{grant_id}/finance/expenditures/{expenditure_id}")
async def delete_expenditure(
    grant_id: str,
    expenditure_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    result = await db.execute(
        select(Expenditure).where(
            Expenditure.id == expenditure_id,
            Expenditure.grant_id == grant_id,
        )
    )
    exp = result.scalar_one_or_none()
    if not exp:
        raise HTTPException(404, "Expenditure not found")
    await db.delete(exp)
    await db.commit()
    return {"ok": True}


# ── Slack config ───────────────────────────────────────────────────────────────

@router.get("/{grant_id}/finance/slack")
async def get_slack_config(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant_or_404(grant_id, db)
    result = await db.execute(select(SlackGrantConfig).where(SlackGrantConfig.grant_id == grant_id))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return None
    d = _serialize(cfg, dt_fields=["created_at", "updated_at"])
    d.pop("slack_bot_token", None)
    return d


@router.put("/{grant_id}/finance/slack")
async def upsert_slack_config(
    grant_id: str,
    data: SlackConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _edit: None = Depends(grant_access(require_editor=True)),
):
    grant = await _get_grant_or_404(grant_id, db)
    _require_active_grant(grant)
    settings = get_settings()
    result = await db.execute(select(SlackGrantConfig).where(SlackGrantConfig.grant_id == grant_id))
    cfg = result.scalar_one_or_none()
    if not cfg:
        cfg = SlackGrantConfig(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            slack_channel_id=data.slack_channel_id,
            slack_channel_name=data.slack_channel_name,
            slack_team_id=data.slack_team_id,
            slack_bot_token=settings.slack_bot_token,
            is_active=data.is_active,
        )
        db.add(cfg)
    else:
        cfg.slack_channel_id = data.slack_channel_id
        cfg.slack_channel_name = data.slack_channel_name
        cfg.slack_team_id = data.slack_team_id
        cfg.is_active = data.is_active
        if settings.slack_bot_token and not cfg.slack_bot_token:
            cfg.slack_bot_token = settings.slack_bot_token
    await db.commit()
    d = _serialize(cfg, dt_fields=["created_at", "updated_at"])
    d.pop("slack_bot_token", None)
    return d


# ── AI endpoints ─────────────────────────────────────────────────────────────

@router.post("/{grant_id}/finance/ai/variance")
async def ai_variance(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    ledger_data = await get_ledger(grant_id, db, current_user)
    return await finance_ai.analyze_variance(
        grant.title,
        ledger_data["categories"],
        ledger_data["ledger"].get("currency", "USD"),
    )


@router.post("/{grant_id}/finance/ai/forecast")
async def ai_forecast(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    ledger_data = await get_ledger(grant_id, db, current_user)
    ledger = ledger_data["ledger"]

    exp_result = await db.execute(select(Expenditure).where(Expenditure.grant_id == grant_id))
    expenditures = exp_result.scalars().all()
    monthly: dict[str, float] = {}
    for e in expenditures:
        if e.expense_date:
            key = e.expense_date.strftime("%Y-%m")
            monthly[key] = monthly.get(key, 0) + float(e.amount)
    monthly_spend = [{"month": k, "amount": v} for k, v in sorted(monthly.items())]

    return await finance_ai.forecast_burn_rate(
        grant.title,
        ledger.get("total_awarded"),
        ledger.get("currency", "USD"),
        ledger.get("start_date"),
        ledger.get("end_date"),
        monthly_spend,
        ledger_data["categories"],
    )


@router.post("/{grant_id}/finance/ai/categorize")
async def ai_categorize(
    grant_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    ledger_data = await get_ledger(grant_id, db, current_user)
    cats = [{"id": c["id"], "name": c["name"]} for c in ledger_data["categories"]]
    return await finance_ai.categorize_fund_request(
        body.get("title", ""),
        body.get("description"),
        body.get("vendor"),
        float(body.get("amount", 0)),
        cats,
    )


@router.post("/{grant_id}/finance/ai/compliance")
async def ai_compliance(
    grant_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant_or_404(grant_id, db)
    ledger_data = await get_ledger(grant_id, db, current_user)
    budget_result = await db.execute(select(BudgetTracker).where(BudgetTracker.grant_id == grant_id))
    budget = budget_result.scalar_one_or_none()
    return await finance_ai.check_request_compliance(
        grant.title,
        grant.funder,
        budget.indirect_cost_rule if budget else None,
        grant.call_requirements,
        body,
        ledger_data["categories"],
    )


@router.get("/{grant_id}/finance/summary")
async def finance_summary(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Compact finance status for workspace overview."""
    grant = await _get_grant_or_404(grant_id, db)
    if grant.grant_stage not in ("active", "awarded"):
        return {"enabled": False}
    from app.services.grant_finance_summary import get_finance_summary
    return await get_finance_summary(grant_id, db)
