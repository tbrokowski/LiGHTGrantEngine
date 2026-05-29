"""Opportunities endpoints — review queue, database, detail pages."""
from typing import Optional
from datetime import date, datetime, timezone, timedelta

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
import hashlib
import json as _json
from sqlalchemy import select, and_, or_, func, desc, case, text as sa_text
from sqlalchemy import Text as SaText
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.opportunity import Opportunity, OpportunityReview, OpportunityStatus
from app.models.institution_opportunity import InstitutionOpportunity
from app.models.document import Document
from app.models.user_opportunity_state import UserOpportunityState
from app.models.user import User
from app.models.institution import Institution
from app.models.institution_source import InstitutionSource
from app.models.grant_member import GrantMember, GrantMemberRole, GrantMemberStatus
from app.routers.auth import get_current_user
from app.auth.permissions import get_redis, invalidate_permission_cache
from app.config import get_settings
from app.schemas.grant_profile import (
    GrantProfile, UserGrantPreferences, merge_keywords, opportunity_matches_keywords, _opp_text,
)

router = APIRouter()
settings = get_settings()

QUEUE_STATUSES = ["new", "needs_review", "in_review"]
SHORTLIST_STATUSES = ["potential_fit"]

# ── Semantic search helpers ────────────────────────────────────────────────────

_SEMANTIC_CANDIDATE_LIMIT = 200
_SEMANTIC_CACHE_TTL = 3600  # 1 hour


async def _get_semantic_candidate_ids(
    db: AsyncSession,
    query: str,
    redis_client=None,
    limit: int = _SEMANTIC_CANDIDATE_LIMIT,
) -> list[str]:
    """
    Return opportunity IDs whose embeddings are closest (cosine distance) to
    the query string. Uses Redis to cache the query embedding for 1 hour.
    Returns an empty list on any failure so callers can degrade gracefully.
    """
    try:
        from app.ai.client import get_embedding

        # Cache key = hash of the normalised query string
        cache_key = f"search_emb:{hashlib.sha256(query.lower().strip().encode()).hexdigest()}"

        embedding: list[float] | None = None

        if redis_client is not None:
            try:
                cached = await redis_client.get(cache_key)
                if cached:
                    embedding = _json.loads(cached)
            except Exception:
                pass

        if embedding is None:
            embedding = await get_embedding(query)
            if embedding and any(v != 0.0 for v in embedding):
                if redis_client is not None:
                    try:
                        await redis_client.setex(cache_key, _SEMANTIC_CACHE_TTL, _json.dumps(embedding))
                    except Exception:
                        pass
            else:
                return []

        # Use raw SQL for the <=> cosine distance operator (pgvector)
        vec_literal = "[" + ",".join(str(v) for v in embedding) + "]"
        result = await db.execute(
            sa_text(
                "SELECT id FROM opportunities "
                "WHERE embedding IS NOT NULL "
                "  AND status != 'duplicate' "
                "  AND (embedding <=> :qvec) < 0.45 "
                "ORDER BY embedding <=> :qvec "
                f"LIMIT {limit}"
            ),
            {"qvec": vec_literal},
        )
        return [row[0] for row in result.fetchall()]

    except Exception:
        return []


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


class ScrapePreviewRequest(BaseModel):
    url: str


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
    unread_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort_by: str = "relevance",
    sort_dir: str = "desc",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """List all grants in the database, optionally sorted by org relevance."""
    inst_id = current_user.institution_id
    filters = [Opportunity.status != "duplicate"]

    if inst_id:
        io_join = and_(
            InstitutionOpportunity.opportunity_id == Opportunity.id,
            InstitutionOpportunity.institution_id == inst_id,
        )
        q = select(Opportunity, InstitutionOpportunity).outerjoin(InstitutionOpportunity, io_join)
    else:
        q = select(Opportunity)

    if status:
        filters.append(Opportunity.status == status)
    if funder:
        filters.append(Opportunity.funder.ilike(f"%{funder}%"))
    if priority:
        if inst_id:
            filters.append(
                or_(
                    InstitutionOpportunity.priority == priority,
                    and_(InstitutionOpportunity.priority.is_(None), Opportunity.priority == priority),
                )
            )
        else:
            filters.append(Opportunity.priority == priority)
    if min_fit_score is not None:
        if inst_id:
            relevance_score = func.coalesce(InstitutionOpportunity.fit_score, Opportunity.fit_score, 0)
        else:
            relevance_score = func.coalesce(Opportunity.fit_score, 0)
        filters.append(relevance_score >= min_fit_score)
    if deadline_before:
        filters.append(Opportunity.deadline <= deadline_before)
    if deadline_after:
        filters.append(Opportunity.deadline >= deadline_after)
    if theme:
        filters.append(Opportunity.thematic_areas.contains([theme]))

    # Semantic candidate IDs (populated below when search is present)
    semantic_ids: list[str] = []

    if search:
        term = f"%{search}%"
        # Keyword + tag text matching: covers title, description, funder, and the
        # universal taxonomy tags in thematic_areas / keywords JSON arrays.
        keyword_filter = or_(
            Opportunity.title.ilike(term),
            Opportunity.description.ilike(term),
            Opportunity.funder.ilike(term),
            func.cast(Opportunity.thematic_areas, SaText).ilike(term),
            func.cast(Opportunity.keywords, SaText).ilike(term),
        )

        # Semantic vector search: only engage when the query has ≥ 2 words
        # (single words are better served by exact ILIKE).
        if len(search.split()) >= 2:
            semantic_ids = await _get_semantic_candidate_ids(db, search, redis_client=redis)

        if semantic_ids:
            # Union of keyword matches and semantic candidates so both paths surface results.
            filters.append(or_(keyword_filter, Opportunity.id.in_(semantic_ids)))
        else:
            filters.append(keyword_filter)

    q = q.where(and_(*filters))

    if unread_only:
        read_subq = (
            select(UserOpportunityState.opportunity_id)
            .where(
                UserOpportunityState.user_id == current_user.id,
                UserOpportunityState.read_at.isnot(None),
            )
        )
        q = q.where(Opportunity.id.notin_(read_subq))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar()

    if inst_id:
        relevance = func.coalesce(InstitutionOpportunity.fit_score, Opportunity.fit_score, 0)
    else:
        relevance = func.coalesce(Opportunity.fit_score, 0)

    if sort_by == "relevance":
        if semantic_ids:
            # When semantic search is active, boost semantic matches to the top
            # of the relevance sort so the most similar grants surface first.
            semantic_boost = case(
                (Opportunity.id.in_(semantic_ids), 1),
                else_=0,
            )
            order_cols = [desc(semantic_boost), desc(relevance), Opportunity.deadline]
        else:
            order_cols = [desc(relevance), Opportunity.deadline]
    else:
        sort_col = getattr(Opportunity, sort_by, Opportunity.date_discovered)
        order_cols = [desc(sort_col) if sort_dir == "desc" else sort_col]

    q = q.order_by(*order_cols).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)

    if inst_id:
        rows = result.all()
        opp_ids = [opp.id for opp, _ in rows]
    else:
        opps = result.scalars().all()
        opp_ids = [opp.id for opp in opps]

    read_map = await _load_read_map(db, current_user.id, opp_ids)
    personal_map = await _load_personal_shortlist_map(db, current_user.id, opp_ids)

    if inst_id:
        items = [
            _opp_summary(
                opp,
                is_read=read_map.get(opp.id, False),
                io=io,
                is_personal_shortlisted=personal_map.get(opp.id, False),
            )
            for opp, io in rows
        ]
    else:
        items = [
            _opp_summary(
                opp,
                is_read=read_map.get(opp.id, False),
                io=None,
                is_personal_shortlisted=personal_map.get(opp.id, False),
            )
            for opp in opps
        ]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


@router.post("/scrape-preview")
async def scrape_preview(
    data: ScrapePreviewRequest,
    current_user: User = Depends(get_current_user),
):
    """Fetch a URL and return extracted grant description/summary for form pre-fill. No DB write."""
    from app.scrapers.detail_fetcher import DetailPageParser
    import asyncio

    parser = DetailPageParser(timeout=20)
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, parser.fetch_and_parse, data.url)
    return {
        "description": result.get("description"),
        "short_summary": result.get("short_summary"),
        "error": result.get("error"),
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


@router.get("/new-opportunities")
async def new_opportunities_shortlist(
    unread_only: bool = True,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unread opportunities ranked by org relevance — for dashboard shortlist."""
    items, read_map, io_map = await _fetch_new_opportunities_pool(db, current_user)
    if unread_only:
        items = [o for o in items if not read_map.get(o.id)]
    total = len(items)
    paged_items = items[offset: offset + limit]
    personal_map = await _load_personal_shortlist_map(db, current_user.id, [o.id for o in paged_items])
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            _opp_summary(
                o,
                is_read=read_map.get(o.id, False),
                io=io_map.get(o.id),
                is_personal_shortlisted=personal_map.get(o.id, False),
            )
            for o in paged_items
        ],
    }


@router.get("/new-opportunities/counts")
async def new_opportunities_counts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unread/total counts for the relevance shortlist (sidebar badge)."""
    items, read_map, io_map = await _fetch_new_opportunities_pool(db, current_user)
    total = len(items)
    unread = sum(1 for o in items if not read_map.get(o.id))
    week_ago = date.today() - timedelta(days=7)
    new_this_week = sum(
        1 for o in items
        if o.date_discovered and o.date_discovered.date() >= week_ago and not read_map.get(o.id)
    )
    high_fit_unread = sum(
        1 for o in items
        if not read_map.get(o.id)
        and (io_map.get(o.id).fit_score if io_map.get(o.id) else o.fit_score or 0) >= 70
    )
    return {
        "total": total,
        "unread": unread,
        "new_this_week": new_this_week,
        "high_fit_unread": high_fit_unread,
    }


@router.get("/queue")
async def review_queue(
    unread_only: bool = False,
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns opportunities needing human review, sorted by fit score desc.

    Supports pagination via ``limit`` and ``offset``. The response always
    includes a ``total`` field with the full (unsliced) count so the UI can
    show "X of Y" and decide whether to render a Load More button.
    """
    items, read_map, io_map = await _fetch_institution_feed(
        db, current_user, statuses=QUEUE_STATUSES
    )
    if unread_only:
        items = [o for o in items if not read_map.get(o.id)]
    total = len(items)
    paged_items = items[offset: offset + limit]
    personal_map = await _load_personal_shortlist_map(db, current_user.id, [o.id for o in paged_items])
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            _opp_summary(
                o,
                is_read=read_map.get(o.id, False),
                io=io_map.get(o.id),
                is_personal_shortlisted=personal_map.get(o.id, False),
            )
            for o in paged_items
        ],
    }


@router.get("/queue/counts")
async def review_queue_counts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight unread/total counts for sidebar badge."""
    items, read_map, _ = await _fetch_institution_feed(db, current_user, statuses=QUEUE_STATUSES)
    total = len(items)
    unread = sum(1 for o in items if not read_map.get(o.id))
    return {"total": total, "unread": unread}


@router.get("/graph-data")
async def get_graph_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    funder: Optional[str] = None,
    theme: Optional[str] = None,
    min_score: Optional[float] = None,
    geography: Optional[str] = None,
    deadline_days: Optional[int] = None,
):
    """Return nodes, weighted edges, and cluster metadata for the graph view.

    Edges come from the kNN cosine-similarity graph stored by the clustering
    task and are filtered to pairs where both endpoints are in the current
    result set. Capped at 2000 edges (highest-weight first) to stay
    wire-friendly.
    """
    from app.models.opportunity_cluster import OpportunityCluster
    from app.models.opportunity_edge import OpportunityEdge

    q = select(Opportunity).where(
        Opportunity.status.notin_(["archived", "duplicate"])
    )
    if funder:
        q = q.where(Opportunity.funder.ilike(f"%{funder}%"))
    if theme:
        q = q.where(Opportunity.thematic_areas.contains([theme]))
    if min_score is not None:
        q = q.where(Opportunity.fit_score >= min_score)
    if geography:
        q = q.where(Opportunity.geography.contains([geography]))
    if deadline_days is not None:
        from datetime import date, timedelta
        cutoff = date.today() + timedelta(days=deadline_days)
        q = q.where(Opportunity.deadline <= cutoff)

    q = q.limit(500)
    result = await db.execute(q)
    opps = result.scalars().all()

    # Load clusters
    clusters_result = await db.execute(select(OpportunityCluster))
    clusters = {c.id: {"id": c.id, "label": c.label, "color": c.color}
                for c in clusters_result.scalars().all()}

    node_ids: set[str] = {o.id for o in opps}

    nodes = []
    for o in opps:
        nodes.append({
            "id": o.id,
            "title": o.title,
            "funder": o.funder,
            "deadline": str(o.deadline) if o.deadline else None,
            "fit_score": o.fit_score,
            "cluster_id": o.cluster_id,
            "thematic_areas": o.thematic_areas or [],
            "geography": o.geography or [],
            "ai_summary": o.ai_summary or o.short_summary,
            "status": o.status,
            "umap_x": o.umap_x,
            "umap_y": o.umap_y,
        })

    # Load edges where both endpoints are in the current result set.
    # Filter server-side using ANY to avoid pulling the full edges table.
    edges_result = await db.execute(
        select(OpportunityEdge)
        .where(OpportunityEdge.source_id.in_(node_ids))
        .where(OpportunityEdge.target_id.in_(node_ids))
        .order_by(OpportunityEdge.weight.desc())
        .limit(2000)
    )
    edges = [
        {"source": e.source_id, "target": e.target_id, "weight": e.weight}
        for e in edges_result.scalars().all()
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "clusters": list(clusters.values()),
        "total": len(nodes),
    }


@router.get("/shortlist")
async def personal_shortlist(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the current user's personal shortlist (saved opportunities)."""
    sl_result = await db.execute(
        select(UserOpportunityState.opportunity_id)
        .where(
            UserOpportunityState.user_id == current_user.id,
            UserOpportunityState.saved_at.isnot(None),
        )
        .order_by(UserOpportunityState.saved_at.desc())
    )
    opp_ids = [row[0] for row in sl_result.all()]
    if not opp_ids:
        return []

    opps_result = await db.execute(
        select(Opportunity).where(Opportunity.id.in_(opp_ids))
    )
    opps = {o.id: o for o in opps_result.scalars().all()}

    io_map: dict[str, InstitutionOpportunity] = {}
    if current_user.institution_id:
        ios_result = await db.execute(
            select(InstitutionOpportunity).where(
                InstitutionOpportunity.institution_id == current_user.institution_id,
                InstitutionOpportunity.opportunity_id.in_(opp_ids),
            )
        )
        io_map = {io.opportunity_id: io for io in ios_result.scalars().all()}

    read_map = await _load_read_map(db, current_user.id, opp_ids)

    result = []
    for opp_id in opp_ids:
        opp = opps.get(opp_id)
        if opp:
            io = io_map.get(opp_id)
            result.append(_opp_summary(
                opp,
                is_read=read_map.get(opp_id, False),
                io=io,
                is_personal_shortlisted=True,
            ))
    return result


@router.get("/org-shortlist")
async def org_shortlist(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the organization-level shortlist (potential_fit) for the user's institution."""
    items, read_map, io_map = await _fetch_institution_feed(
        db, current_user, statuses=SHORTLIST_STATUSES
    )
    personal_map = await _load_personal_shortlist_map(db, current_user.id, [o.id for o in items])
    return [
        _opp_summary(
            o,
            is_read=read_map.get(o.id, False),
            io=io_map.get(o.id),
            is_personal_shortlisted=personal_map.get(o.id, False),
        )
        for o in items
    ]


@router.get("/{opp_id}")
async def get_opportunity(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    opp = await _get_opp_or_404(opp_id, db)
    await _mark_read(db, current_user.id, opp_id)
    read_map = await _load_read_map(db, current_user.id, [opp_id])
    # Load reviews
    reviews_q = select(OpportunityReview).where(OpportunityReview.opportunity_id == opp_id)
    reviews = (await db.execute(reviews_q)).scalars().all()
    io = await _get_institution_opp(db, current_user, opp_id)
    docs_q = select(Document).where(Document.opportunity_id == opp_id)
    docs = (await db.execute(docs_q)).scalars().all()
    return {
        **_opp_full(opp, io),
        "documents": [_document_summary(d) for d in docs],
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
    """Update opportunity fields.

    Per-org fields (status, fit_score, priority, fit_rationale,
    assigned_reviewer_id, notes) are written to institution_opportunities.
    Content fields go to the global opportunities record.
    """
    opp = await _get_opp_or_404(opp_id, db)
    updates = data.model_dump(exclude_none=True)

    # Fields that belong on institution_opportunities, not the global record
    io_fields = {"status", "fit_score", "priority", "assigned_reviewer_id", "notes"}
    io_updates = {k: v for k, v in updates.items() if k in io_fields}
    opp_updates = {k: v for k, v in updates.items() if k not in io_fields}

    for k, v in opp_updates.items():
        setattr(opp, k, v)

    if io_updates and current_user.institution_id:
        io = await _get_institution_opp(db, current_user, opp_id)
        if io:
            for k, v in io_updates.items():
                setattr(io, k, v)

    await db.commit()
    io = await _get_institution_opp(db, current_user, opp_id)
    return {"id": opp.id, "status": io.status if io else opp.status}


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
    io = await _get_institution_opp(db, current_user, opp_id)
    if io:
        io.status = data.review_status
    opp = await _get_opp_or_404(opp_id, db)
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


def _build_call_requirements(opp) -> str:
    """Compile opportunity fields into structured call requirements text for the grant workspace."""
    parts: list[str] = []

    if opp.description or opp.short_summary:
        parts.append("## Overview\n" + (opp.description or opp.short_summary or ""))

    if opp.eligibility_criteria:
        parts.append("## Eligibility\n" + opp.eligibility_criteria)

    if opp.evaluation_criteria:
        parts.append("## Evaluation Criteria\n" + opp.evaluation_criteria)

    if opp.partner_requirements:
        parts.append("## Partner Requirements\n" + opp.partner_requirements)

    if opp.required_documents:
        docs = opp.required_documents
        doc_list = "\n".join(f"- {d}" for d in docs) if isinstance(docs, list) else str(docs)
        parts.append("## Required Documents\n" + doc_list)

    sub_lines: list[str] = []
    if opp.submission_portal:
        sub_lines.append(f"**Portal:** {opp.submission_portal}")
    if opp.project_duration:
        sub_lines.append(f"**Duration:** {opp.project_duration}")
    if opp.cost_sharing_requirements:
        sub_lines.append(f"**Cost sharing:** {opp.cost_sharing_requirements}")
    if opp.indirect_cost_rules:
        sub_lines.append(f"**Indirect costs:** {opp.indirect_cost_rules}")
    if opp.expected_awards:
        sub_lines.append(f"**Expected awards:** {opp.expected_awards}")
    if sub_lines:
        parts.append("## Submission Details\n" + "\n".join(sub_lines))

    if opp.contact_information:
        parts.append("## Contact\n" + opp.contact_information)

    return "\n\n".join(parts)


@router.post("/{opp_id}/convert-to-grant")
async def convert_to_grant(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Convert an opportunity into an active grant workspace, loading full call context."""
    import uuid
    from app.models.active_grant import ActiveGrant
    from app.models.document import Document

    opp = await _get_opp_or_404(opp_id, db)
    call_reqs = _build_call_requirements(opp)

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
        institution_id=current_user.institution_id,
        created_by_id=current_user.id,
        call_requirements=call_reqs or None,
    )
    db.add(grant)
    await db.flush()  # get grant.id before commit

    # Creator gets owner membership so grant_access() works for all users
    member = GrantMember(
        id=str(uuid.uuid4()),
        grant_id=grant.id,
        user_id=current_user.id,
        email=current_user.email,
        role=GrantMemberRole.OWNER,
        status=GrantMemberStatus.ACCEPTED,
        invited_by_id=current_user.id,
    )
    db.add(member)

    # Link existing opportunity documents to the new grant
    doc_result = await db.execute(
        select(Document).where(Document.opportunity_id == opp_id)
    )
    existing_docs = doc_result.scalars().all()
    from app.config import get_settings
    api_url = get_settings().api_url.rstrip("/")
    for doc in existing_docs:
        linked_id = str(uuid.uuid4())
        linked = Document(
            id=linked_id,
            grant_id=grant.id,
            opportunity_id=opp_id,
            file_name=doc.file_name,
            file_url=f"{api_url}/api/v1/documents/{linked_id}/content",
            file_format=doc.file_format,
            document_type=doc.document_type or "call_document",
            processing_status=doc.processing_status,
            parsed_text=doc.parsed_text,
            notes=doc.notes,
            uploaded_by_id=current_user.id,
        )
        db.add(linked)

    io = await _get_institution_opp(db, current_user, opp_id)
    if io:
        io.status = "actively_pursuing"

    await db.commit()
    await db.refresh(grant)
    await invalidate_permission_cache(current_user.id, redis)

    # Queue PDF fetcher if no existing documents and a source URL is available
    if not existing_docs and opp.opportunity_url:
        try:
            from app.workers.celery_app import celery_app
            celery_app.send_task(
                "app.workers.enrichment_tasks.enrich_opportunity_force",
                args=[opp_id],
            )
        except Exception:
            pass

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


@router.post("/{opp_id}/add-to-shortlist")
async def add_to_shortlist(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save an opportunity to the current user's personal shortlist.

    Writes to user_opportunity_states.saved_at (canonical). The legacy
    user_shortlists table is no longer written to but is kept in the DB.
    """
    await _get_opp_or_404(opp_id, db)
    now = datetime.now(timezone.utc)
    existing = (await db.execute(
        select(UserOpportunityState).where(
            UserOpportunityState.user_id == current_user.id,
            UserOpportunityState.opportunity_id == opp_id,
        )
    )).scalar_one_or_none()
    if existing:
        existing.saved_at = now
    else:
        db.add(UserOpportunityState(
            user_id=current_user.id,
            opportunity_id=opp_id,
            saved_at=now,
        ))
    await db.commit()
    return {"id": opp_id, "shortlisted": True}


@router.post("/{opp_id}/remove-from-shortlist")
async def remove_from_shortlist(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove an opportunity from the current user's personal shortlist."""
    await _get_opp_or_404(opp_id, db)
    state = (await db.execute(
        select(UserOpportunityState).where(
            UserOpportunityState.user_id == current_user.id,
            UserOpportunityState.opportunity_id == opp_id,
        )
    )).scalar_one_or_none()
    if state:
        state.saved_at = None
        await db.commit()
    return {"id": opp_id, "shortlisted": False}


@router.post("/{opp_id}/promote-to-org-shortlist")
async def promote_to_org_shortlist(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Promote an opportunity to the organization-level shortlist (potential_fit)."""
    if not current_user.institution_id:
        raise HTTPException(400, "You must belong to an organization to use the org shortlist")
    await _get_opp_or_404(opp_id, db)
    io = await _get_institution_opp(db, current_user, opp_id)
    if not io:
        raise HTTPException(404, "Opportunity is not in your organization's feed")
    io.status = "potential_fit"
    await db.commit()
    return {"id": opp_id, "is_on_org_shortlist": True}


@router.post("/{opp_id}/remove-from-org-shortlist")
async def remove_from_org_shortlist(
    opp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove an opportunity from the organization-level shortlist."""
    await _get_opp_or_404(opp_id, db)
    io = await _get_institution_opp(db, current_user, opp_id)
    if not io or io.status != "potential_fit":
        raise HTTPException(400, "Opportunity is not on the org shortlist")
    io.status = "in_review"
    await db.commit()
    return {"id": opp_id, "is_on_org_shortlist": False}


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _get_opp_or_404(opp_id: str, db: AsyncSession) -> Opportunity:
    result = await db.execute(select(Opportunity).where(Opportunity.id == opp_id))
    opp = result.scalar_one_or_none()
    if not opp:
        raise HTTPException(404, "Opportunity not found")
    return opp


def _opp_summary(
    o: Opportunity,
    is_read: bool = False,
    io: InstitutionOpportunity | None = None,
    is_personal_shortlisted: bool = False,
) -> dict:
    fit_score = io.fit_score if io else o.fit_score
    priority = io.priority if io else o.priority
    status = io.status if io else o.status
    return {
        "id": o.id, "title": o.title, "funder": o.funder,
        "deadline": str(o.deadline) if o.deadline else None,
        "fit_score": fit_score, "priority": priority,
        "status": status, "thematic_areas": o.thematic_areas,
        "award_min": o.award_min, "award_max": o.award_max, "currency": o.currency,
        "date_discovered": str(o.date_discovered),
        "short_summary": o.short_summary or (io.ai_summary[:300] if io and io.ai_summary else None) or (o.ai_summary[:300] if o.ai_summary else None),
        "description": o.description or o.parsed_text,
        "has_description": bool(o.description or o.parsed_text),
        "funder_logo_url": o.funder_logo_url,
        "opportunity_url": o.opportunity_url,
        "is_read": is_read,
        "fit_rationale": io.fit_rationale if io else o.fit_rationale,
        "is_personal_shortlisted": is_personal_shortlisted,
        "is_on_org_shortlist": bool(io and io.status == "potential_fit"),
    }


def _document_summary(d: Document) -> dict:
    return {
        "id": d.id,
        "file_name": d.file_name,
        "file_url": d.file_url,
        "document_type": d.document_type,
        "processing_status": d.processing_status,
    }


def _opp_full(o: Opportunity, io: InstitutionOpportunity | None = None) -> dict:
    d = {c.name: getattr(o, c.name) for c in o.__table__.columns if c.name != "embedding"}
    if io:
        d["fit_score"] = io.fit_score
        d["priority"] = io.priority
        d["status"] = io.status
        d["fit_rationale"] = io.fit_rationale
        d["ai_summary"] = io.ai_summary or o.ai_summary
    if d.get("deadline"):
        d["deadline"] = str(d["deadline"])
    if d.get("date_discovered"):
        d["date_discovered"] = str(d["date_discovered"])
    d["description"] = o.description or o.parsed_text
    d["has_description"] = bool(o.description or o.parsed_text)
    return d


def _review_dict(r: OpportunityReview) -> dict:
    return {c.name: getattr(r, c.name) for c in r.__table__.columns}


async def _fetch_queue_with_read_state(
    db: AsyncSession, user: User
) -> tuple[list[Opportunity], dict[str, bool], dict[str, InstitutionOpportunity]]:
    items, read_map, io_map = await _fetch_institution_feed(db, user, statuses=QUEUE_STATUSES)
    return items, read_map, io_map


async def _fetch_institution_feed(
    db: AsyncSession,
    user: User,
    statuses: list[str] | None,
) -> tuple[list[Opportunity], dict[str, bool], dict[str, InstitutionOpportunity]]:
    if not user.institution_id:
        return [], {}, {}

    personal = UserGrantPreferences.from_dict(user.grant_preferences or {})
    personal_keywords = [k.lower() for k in personal.keywords if k]
    personal_excluded = [k.lower() for k in personal.excluded_keywords if k]

    enabled_source_ids = await _enabled_source_ids(db, user.institution_id)

    join_conditions = [
        InstitutionOpportunity.opportunity_id == Opportunity.id,
        InstitutionOpportunity.institution_id == user.institution_id,
    ]
    if statuses is not None:
        join_conditions.append(InstitutionOpportunity.status.in_(statuses))

    q = (
        select(Opportunity, InstitutionOpportunity)
        .join(InstitutionOpportunity, and_(*join_conditions))
        .where(Opportunity.status != "duplicate")
        .order_by(desc(InstitutionOpportunity.fit_score), Opportunity.deadline)
    )
    result = await db.execute(q)
    rows = result.all()

    from app.services.opportunity_dedup import dedup_key, _funder_prefix

    items: list[Opportunity] = []
    io_map: dict[str, InstitutionOpportunity] = {}
    for opp, io in rows:
        if enabled_source_ids is not None and opp.source_id and opp.source_id not in enabled_source_ids:
            continue
        if personal_excluded and any(kw in _opp_text(opp) for kw in personal_excluded):
            continue
        if personal_keywords and not any(kw in _opp_text(opp) for kw in personal_keywords):
            continue
        items.append(opp)
        io_map[opp.id] = io

    # Collapse display-level duplicates. Rows are sorted by fit_score DESC so
    # the highest-scoring version of each duplicate group is kept.
    # Primary key: stable extid / URL-based key from dedup_key().
    # Secondary key: title+funder_prefix catches cases where program_name is
    # NULL for old entries and dedup_key falls back to a year-specific URL.
    seen_keys: set[str] = set()
    seen_titles: set[str] = set()
    deduped_items: list[Opportunity] = []
    deduped_io: dict[str, InstitutionOpportunity] = {}
    for opp in items:
        k = dedup_key(opp)
        title_key = (
            f"t:{(opp.title or '').strip().lower()}|{_funder_prefix(opp.funder or '')}"
            if opp.title
            else None
        )
        if (k and k in seen_keys) or (title_key and title_key in seen_titles):
            continue
        if k:
            seen_keys.add(k)
        if title_key:
            seen_titles.add(title_key)
        deduped_items.append(opp)
        if opp.id in io_map:
            deduped_io[opp.id] = io_map[opp.id]
    items, io_map = deduped_items, deduped_io

    read_map = await _load_read_map(db, user.id, [o.id for o in items])
    return items, read_map, io_map


async def _fetch_new_opportunities_pool(
    db: AsyncSession,
    user: User,
) -> tuple[list[Opportunity], dict[str, bool], dict[str, InstitutionOpportunity]]:
    """All institution-surfaced grants ranked by org relevance (for shortlist)."""
    return await _fetch_institution_feed(db, user, statuses=None)


async def get_shortlist_stats(db: AsyncSession, user: User) -> dict:
    """Dashboard analytics: unread shortlist counts by institution relevance."""
    items, read_map, io_map = await _fetch_new_opportunities_pool(db, user)
    week_ago = date.today() - timedelta(days=7)
    unread = [o for o in items if not read_map.get(o.id)]
    new_this_week = sum(
        1 for o in unread
        if o.date_discovered and o.date_discovered.date() >= week_ago
    )
    high_fit_pending = sum(
        1 for o in unread
        if (io_map.get(o.id).fit_score if io_map.get(o.id) else o.fit_score or 0) >= 70
    )
    return {
        "new_opportunities_this_week": new_this_week,
        "high_fit_pending_review": high_fit_pending,
        "unread": len(unread),
    }


async def _get_institution_opp(
    db: AsyncSession, user: User, opp_id: str
) -> InstitutionOpportunity | None:
    if not user.institution_id:
        return None
    result = await db.execute(
        select(InstitutionOpportunity).where(
            InstitutionOpportunity.institution_id == user.institution_id,
            InstitutionOpportunity.opportunity_id == opp_id,
        )
    )
    return result.scalar_one_or_none()


async def _require_institution_access(db: AsyncSession, user: User, opp_id: str) -> None:
    io = await _get_institution_opp(db, user, opp_id)
    if user.institution_id and not io:
        raise HTTPException(404, "Opportunity not found in your organization's feed")


async def _enabled_source_ids(db: AsyncSession, institution_id: str) -> set[str] | None:
    rows = (await db.execute(
        select(InstitutionSource.source_id, InstitutionSource.is_enabled).where(
            InstitutionSource.institution_id == institution_id
        )
    )).all()
    if not rows:
        return None
    enabled = {sid for sid, is_on in rows if is_on}
    if len(enabled) == len(rows):
        return None
    return enabled


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


async def _load_personal_shortlist_map(
    db: AsyncSession, user_id: str, opp_ids: list[str]
) -> dict[str, bool]:
    """Returns a map of opportunity_id → True for opportunities the user has saved.

    Reads from user_opportunity_states.saved_at (new canonical source).
    user_shortlists is kept in the DB but new saves/reads go through
    user_opportunity_states only.
    """
    if not opp_ids:
        return {}
    result = await db.execute(
        select(UserOpportunityState.opportunity_id).where(
            UserOpportunityState.user_id == user_id,
            UserOpportunityState.opportunity_id.in_(opp_ids),
            UserOpportunityState.saved_at.isnot(None),
        )
    )
    return {row[0]: True for row in result.all()}


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
