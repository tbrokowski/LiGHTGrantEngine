"""Opportunities endpoints — review queue, database, detail pages."""
from typing import Optional
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.opportunity import Opportunity, OpportunityReview, OpportunityStatus
from app.models.user_opportunity_state import UserOpportunityState
from app.models.user import User
from app.routers.auth import get_current_user
from app.config import get_settings

router = APIRouter()
settings = get_settings()

QUEUE_STATUSES = ["new", "needs_review", "in_review"]


# ── Schemas ───────────────────────────────────────────────────────────────────
class OpportunityCreate(BaseModel):
    title: str
    funder: Optional[str] = None
    program_name: Optional[str] = None
    description: Optional[str] = None
    deadline: Optional[date] = None
    award_min: Optional[float] = None
    award_max: Optional[float] = None
    currency: Optional[str] = None
    opportunity_url: Optional[str] = None
    thematic_areas: list[str] = []
    geography: list[str] = []
    keywords: list[str] = []
    eligibility_criteria: Optional[str] = None
    source_id: Optional[str] = None


class OpportunityUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_reviewer_id: Optional[str] = None
    notes: Optional[str] = None
    fit_score: Optional[float] = None
    thematic_areas: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    description: Optional[str] = None
    short_summary: Optional[str] = None
    parsed_text: Optional[str] = None


class ReviewCreate(BaseModel):
    review_status: str
    recommendation: Optional[str] = None
    fit_comments: Optional[str] = None
    eligibility_comments: Optional[str] = None
    risk_notes: Optional[str] = None
    decision: Optional[str] = None
    decision_reason: Optional[str] = None
    follow_up_actions: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/")
async def list_opportunities(
    status: Optional[str] = None,
    funder: Optional[str] = None,
    priority: Optional[str] = None,
    min_fit_score: Optional[float] = None,
    deadline_before: Optional[date] = None,
    deadline_after: Optional[date] = None,
    theme: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort_by: str = "date_discovered",
    sort_dir: str = "desc",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Opportunity)
    filters = []

    if status:
        filters.append(Opportunity.status == status)
    if funder:
        filters.append(Opportunity.funder.ilike(f"%{funder}%"))
    if priority:
        filters.append(Opportunity.priority == priority)
    if min_fit_score is not None:
        filters.append(Opportunity.fit_score >= min_fit_score)
    if deadline_before:
        filters.append(Opportunity.deadline <= deadline_before)
    if deadline_after:
        filters.append(Opportunity.deadline >= deadline_after)
    if theme:
        filters.append(Opportunity.thematic_areas.contains([theme]))
    if search:
        filters.append(
            or_(
                Opportunity.title.ilike(f"%{search}%"),
                Opportunity.description.ilike(f"%{search}%"),
                Opportunity.funder.ilike(f"%{search}%"),
            )
        )
    if filters:
        q = q.where(and_(*filters))

    # Count
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar()

    # Sort
    sort_col = getattr(Opportunity, sort_by, Opportunity.date_discovered)
    q = q.order_by(desc(sort_col) if sort_dir == "desc" else sort_col)
    q = q.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(q)
    items = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_opp_summary(o) for o in items],
    }


@router.post("/", status_code=201)
async def create_opportunity(
    data: OpportunityCreate,
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import uuid
    opp = Opportunity(id=str(uuid.uuid4()), **data.model_dump())
    opp.status = OpportunityStatus.NEW
    db.add(opp)
    await db.commit()
    await db.refresh(opp)

    # Score in background
    bg.add_task(_score_opportunity_bg, str(opp.id))
    return {"id": opp.id, "status": "created"}


@router.get("/queue")
async def review_queue(
    unread_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns opportunities needing human review, sorted by fit score desc."""
    items, read_map = await _fetch_queue_with_read_state(db, current_user.id)
    if unread_only:
        items = [o for o in items if not read_map.get(o.id)]
    return [_opp_summary(o, is_read=read_map.get(o.id, False)) for o in items]


@router.get("/queue/counts")
async def review_queue_counts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight unread/total counts for sidebar badge."""
    items, read_map = await _fetch_queue_with_read_state(db, current_user.id)
    total = len(items)
    unread = sum(1 for o in items if not read_map.get(o.id))
    return {"total": total, "unread": unread}


@router.get("/shortlist")
async def shortlist(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns shortlisted opportunities (potential_fit), sorted by fit score desc."""
    q = select(Opportunity).where(
        Opportunity.status == OpportunityStatus.POTENTIAL_FIT
    ).order_by(desc(Opportunity.fit_score), Opportunity.deadline)
    result = await db.execute(q)
    items = result.scalars().all()
    read_map = await _load_read_map(db, current_user.id, [o.id for o in items])
    return [_opp_summary(o, is_read=read_map.get(o.id, False)) for o in items]


@router.get("/{opp_id}")
async def get_opportunity(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    opp = await _get_opp_or_404(opp_id, db)
    # Auto-mark as read when viewing detail
    await _mark_read(db, current_user.id, opp_id)
    read_map = await _load_read_map(db, current_user.id, [opp_id])
    # Load reviews
    reviews_q = select(OpportunityReview).where(OpportunityReview.opportunity_id == opp_id)
    reviews = (await db.execute(reviews_q)).scalars().all()
    return {
        **_opp_full(opp),
        "is_read": read_map.get(opp_id, True),
        "reviews": [_review_dict(r) for r in reviews],
    }


@router.patch("/{opp_id}")
async def update_opportunity(
    opp_id: str,
    data: OpportunityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    opp = await _get_opp_or_404(opp_id, db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(opp, k, v)
    await db.commit()
    return {"id": opp.id, "status": opp.status}


@router.post("/{opp_id}/reviews")
async def submit_review(
    opp_id: str,
    data: ReviewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import uuid
    await _get_opp_or_404(opp_id, db)
    review = OpportunityReview(
        id=str(uuid.uuid4()),
        opportunity_id=opp_id,
        reviewer_id=current_user.id,
        **data.model_dump(),
    )
    db.add(review)
    # Sync status on opportunity
    opp = await _get_opp_or_404(opp_id, db)
    opp.status = data.review_status
    await db.commit()
    return {"id": review.id}


@router.post("/{opp_id}/re-enrich")
async def re_enrich_opportunity(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force re-fetch the grant detail page and refresh description fields."""
    opp = await _get_opp_or_404(opp_id, db)
    from app.workers.celery_app import celery_app
    if opp.opportunity_url:
        celery_app.send_task(
            "app.workers.enrichment_tasks.enrich_opportunity_force",
            args=[opp_id],
        )
    # Always queue an AI summary generation (works even without a URL if description exists)
    celery_app.send_task(
        "app.workers.enrichment_tasks.generate_ai_summary",
        args=[opp_id],
    )
    return {"status": "queued", "message": "Re-enrichment and AI summary queued"}


@router.post("/{opp_id}/convert-to-grant")
async def convert_to_grant(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Convert an opportunity into an active grant workspace."""
    import uuid
    from app.models.active_grant import ActiveGrant

    opp = await _get_opp_or_404(opp_id, db)
    grant = ActiveGrant(
        id=str(uuid.uuid4()),
        opportunity_id=opp_id,
        title=opp.title,
        funder=opp.funder,
        program=opp.program_name,
        call_url=opp.opportunity_url,
        external_deadline=opp.deadline,
        requested_amount=opp.award_max,
        currency=opp.currency,
        themes=opp.thematic_areas,
        geographies=opp.geography,
        internal_lead_id=current_user.id,
    )
    db.add(grant)
    opp.status = "actively_pursuing"
    await db.commit()
    await db.refresh(grant)
    return {"grant_id": grant.id, "message": "Active grant workspace created"}


@router.post("/{opp_id}/mark-read")
async def mark_read(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_opp_or_404(opp_id, db)
    await _mark_read(db, current_user.id, opp_id)
    return {"id": opp_id, "is_read": True}


@router.post("/{opp_id}/mark-unread")
async def mark_unread(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_opp_or_404(opp_id, db)
    await _mark_unread(db, current_user.id, opp_id)
    return {"id": opp_id, "is_read": False}


@router.post("/{opp_id}/remove-from-shortlist")
async def remove_from_shortlist(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    opp = await _get_opp_or_404(opp_id, db)
    if opp.status != OpportunityStatus.POTENTIAL_FIT:
        raise HTTPException(400, "Opportunity is not on the shortlist")
    opp.status = OpportunityStatus.IN_REVIEW
    await db.commit()
    return {"id": opp_id, "status": opp.status}


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _get_opp_or_404(opp_id: str, db: AsyncSession) -> Opportunity:
    result = await db.execute(select(Opportunity).where(Opportunity.id == opp_id))
    opp = result.scalar_one_or_none()
    if not opp:
        raise HTTPException(404, "Opportunity not found")
    return opp


def _opp_summary(o: Opportunity, is_read: bool = False) -> dict:
    return {
        "id": o.id, "title": o.title, "funder": o.funder,
        "deadline": str(o.deadline) if o.deadline else None,
        "fit_score": o.fit_score, "priority": o.priority,
        "status": o.status, "thematic_areas": o.thematic_areas,
        "award_min": o.award_min, "award_max": o.award_max, "currency": o.currency,
        "date_discovered": str(o.date_discovered),
        "short_summary": o.short_summary,
        "description": o.description or o.parsed_text,
        "has_description": bool(o.description or o.parsed_text),
        "funder_logo_url": o.funder_logo_url,
        "opportunity_url": o.opportunity_url,
        "is_read": is_read,
    }


def _opp_full(o: Opportunity) -> dict:
    d = {c.name: getattr(o, c.name) for c in o.__table__.columns if c.name != "embedding"}
    if d.get("deadline"):
        d["deadline"] = str(d["deadline"])
    if d.get("date_discovered"):
        d["date_discovered"] = str(d["date_discovered"])
    return d


def _review_dict(r: OpportunityReview) -> dict:
    return {c.name: getattr(r, c.name) for c in r.__table__.columns}


async def _fetch_queue_with_read_state(
    db: AsyncSession, user_id: str
) -> tuple[list[Opportunity], dict[str, bool]]:
    q = select(Opportunity).where(
        Opportunity.status.in_(QUEUE_STATUSES)
    ).order_by(desc(Opportunity.fit_score), Opportunity.deadline)
    result = await db.execute(q)
    items = list(result.scalars().all())
    read_map = await _load_read_map(db, user_id, [o.id for o in items])
    return items, read_map


async def _load_read_map(
    db: AsyncSession, user_id: str, opp_ids: list[str]
) -> dict[str, bool]:
    if not opp_ids:
        return {}
    q = select(UserOpportunityState).where(
        UserOpportunityState.user_id == user_id,
        UserOpportunityState.opportunity_id.in_(opp_ids),
        UserOpportunityState.read_at.isnot(None),
    )
    result = await db.execute(q)
    states = result.scalars().all()
    return {s.opportunity_id: True for s in states}


async def _mark_read(db: AsyncSession, user_id: str, opp_id: str) -> None:
    q = select(UserOpportunityState).where(
        UserOpportunityState.user_id == user_id,
        UserOpportunityState.opportunity_id == opp_id,
    )
    result = await db.execute(q)
    state = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if state:
        state.read_at = now
    else:
        db.add(UserOpportunityState(user_id=user_id, opportunity_id=opp_id, read_at=now))
    await db.commit()


async def _mark_unread(db: AsyncSession, user_id: str, opp_id: str) -> None:
    q = select(UserOpportunityState).where(
        UserOpportunityState.user_id == user_id,
        UserOpportunityState.opportunity_id == opp_id,
    )
    result = await db.execute(q)
    state = result.scalar_one_or_none()
    if state:
        state.read_at = None
        await db.commit()


async def _score_opportunity_bg(opp_id: str):
    """Background task: score an opportunity using the AI fit scorer."""
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.discovery_tasks.score_opportunity", args=[opp_id])
