"""Opportunities endpoints — review queue, database, detail pages."""
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.opportunity import Opportunity, OpportunityReview, OpportunityStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.config import get_settings

router = APIRouter()
settings = get_settings()


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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns opportunities needing human review, sorted by fit score desc."""
    q = select(Opportunity).where(
        Opportunity.status.in_(["new", "needs_review", "in_review"])
    ).order_by(desc(Opportunity.fit_score), Opportunity.deadline)
    result = await db.execute(q)
    items = result.scalars().all()
    return [_opp_summary(o) for o in items]


@router.get("/{opp_id}")
async def get_opportunity(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    opp = await _get_opp_or_404(opp_id, db)
    # Load reviews
    reviews_q = select(OpportunityReview).where(OpportunityReview.opportunity_id == opp_id)
    reviews = (await db.execute(reviews_q)).scalars().all()
    return {**_opp_full(opp), "reviews": [_review_dict(r) for r in reviews]}


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


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _get_opp_or_404(opp_id: str, db: AsyncSession) -> Opportunity:
    result = await db.execute(select(Opportunity).where(Opportunity.id == opp_id))
    opp = result.scalar_one_or_none()
    if not opp:
        raise HTTPException(404, "Opportunity not found")
    return opp


def _opp_summary(o: Opportunity) -> dict:
    return {
        "id": o.id, "title": o.title, "funder": o.funder,
        "deadline": str(o.deadline) if o.deadline else None,
        "fit_score": o.fit_score, "priority": o.priority,
        "status": o.status, "thematic_areas": o.thematic_areas,
        "award_min": o.award_min, "award_max": o.award_max, "currency": o.currency,
        "date_discovered": str(o.date_discovered),
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


async def _score_opportunity_bg(opp_id: str):
    """Background task: score an opportunity using Qwen fit scorer."""
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.discovery_tasks.score_opportunity", args=[opp_id])
