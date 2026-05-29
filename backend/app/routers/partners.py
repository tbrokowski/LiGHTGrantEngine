"""CRM Partners endpoints — full contact management, meetings, documents, AI enrichment."""
import uuid
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, desc, or_, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.partner import Partner, PartnerUpdate, PartnerGrantLink
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import has_module_permission

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PartnerCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    organization_id: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    tags: list[str] = []
    project_types: list[str] = []
    status: str = "active"
    relationship_stage: str = "prospect"
    notes: Optional[str] = None
    orcid: Optional[str] = None
    google_scholar_id: Optional[str] = None
    department: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None


class PartnerUpdateSchema(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    organization_id: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    tags: Optional[list[str]] = None
    project_types: Optional[list[str]] = None
    status: Optional[str] = None
    relationship_stage: Optional[str] = None
    notes: Optional[str] = None
    orcid: Optional[str] = None
    google_scholar_id: Optional[str] = None
    department: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    avatar_url: Optional[str] = None


class ContactLogCreate(BaseModel):
    content: str
    update_type: str = "note"
    contact_date: Optional[datetime] = None
    next_contact_date: Optional[datetime] = None


class PartnerLinkCreate(BaseModel):
    entity_type: str
    entity_id: str
    relationship: str = "collaborator"
    notes: Optional[str] = None


class StageUpdate(BaseModel):
    relationship_stage: str


# ── Helper serializers ────────────────────────────────────────────────────────

def _partner_summary(p: Partner, next_contact_date: datetime | None = None) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "email": p.email,
        "phone": p.phone,
        "organization": p.organization,
        "organization_id": p.organization_id,
        "title": p.title,
        "tags": p.tags,
        "project_types": p.project_types,
        "status": p.status,
        "relationship_stage": p.relationship_stage,
        "avatar_url": p.avatar_url,
        "department": p.department,
        "country": p.country,
        "city": p.city,
        "h_index": p.h_index,
        "orcid": p.orcid,
        "enrichment_status": p.enrichment_status,
        "last_enriched_at": str(p.last_enriched_at) if p.last_enriched_at else None,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
        "next_contact_date": str(next_contact_date) if next_contact_date else None,
    }


def _partner_full(p: Partner) -> dict:
    d = {
        "id": p.id,
        "name": p.name,
        "email": p.email,
        "phone": p.phone,
        "organization": p.organization,
        "organization_id": p.organization_id,
        "title": p.title,
        "linkedin_url": p.linkedin_url,
        "website": p.website,
        "tags": p.tags,
        "project_types": p.project_types,
        "status": p.status,
        "relationship_stage": p.relationship_stage,
        "notes": p.notes,
        "avatar_url": p.avatar_url,
        "department": p.department,
        "country": p.country,
        "city": p.city,
        "orcid": p.orcid,
        "google_scholar_id": p.google_scholar_id,
        "h_index": p.h_index,
        "enrichment_status": p.enrichment_status,
        "enrichment_source": p.enrichment_source,
        "last_enriched_at": str(p.last_enriched_at) if p.last_enriched_at else None,
        "created_by": p.created_by,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }
    return d


def _update_dict(u: PartnerUpdate) -> dict:
    return {
        "id": u.id,
        "partner_id": u.partner_id,
        "user_id": u.user_id,
        "content": u.content,
        "update_type": u.update_type,
        "contact_date": str(u.contact_date) if u.contact_date else None,
        "next_contact_date": str(u.next_contact_date) if u.next_contact_date else None,
        "created_at": str(u.created_at) if u.created_at else None,
    }


def _link_dict(lnk: PartnerGrantLink) -> dict:
    return {
        "id": lnk.id,
        "partner_id": lnk.partner_id,
        "entity_type": lnk.entity_type,
        "entity_id": lnk.entity_id,
        "relationship": lnk.relationship,
        "notes": lnk.notes,
        "created_by": lnk.created_by,
        "created_at": str(lnk.created_at) if lnk.created_at else None,
    }


async def _get_partner_or_404(partner_id: str, db: AsyncSession) -> Partner:
    result = await db.execute(select(Partner).where(Partner.id == partner_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Partner not found")
    return p


async def _get_next_contact(partner_id: str, db: AsyncSession) -> datetime | None:
    subq_result = await db.execute(
        select(func.max(PartnerUpdate.next_contact_date))
        .where(
            PartnerUpdate.partner_id == partner_id,
            PartnerUpdate.next_contact_date.isnot(None),
        )
    )
    return subq_result.scalar_one_or_none()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/analytics")
async def partner_analytics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return engagement analytics for the partners dashboard."""
    if not has_module_permission(current_user, "can_view_partners"):
        raise HTTPException(status_code=403, detail="No access to partners.")

    from app.models.partner_meeting import PartnerMeeting

    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    ninety_days_ago = now - timedelta(days=90)

    # Total partners by stage
    stage_counts_result = await db.execute(
        select(Partner.relationship_stage, func.count(Partner.id))
        .group_by(Partner.relationship_stage)
    )
    stage_counts = dict(stage_counts_result.all())

    # Interactions in last 30 days
    recent_interactions = (await db.execute(
        select(func.count(PartnerUpdate.id))
        .where(PartnerUpdate.created_at >= thirty_days_ago)
    )).scalar() or 0

    # Meetings in next 30 days
    upcoming_meetings = (await db.execute(
        select(func.count(PartnerMeeting.id))
        .where(
            and_(
                PartnerMeeting.scheduled_at >= now,
                PartnerMeeting.scheduled_at <= now + timedelta(days=30),
                PartnerMeeting.completed_at.is_(None),
            )
        )
    )).scalar() or 0

    # Overdue follow-ups
    overdue_count = (await db.execute(
        select(func.count(func.distinct(PartnerUpdate.partner_id)))
        .where(
            and_(
                PartnerUpdate.next_contact_date.isnot(None),
                PartnerUpdate.next_contact_date < now,
            )
        )
    )).scalar() or 0

    # Stale partners (no contact in 90 days)
    active_partner_ids = (await db.execute(
        select(PartnerUpdate.partner_id)
        .where(PartnerUpdate.created_at >= ninety_days_ago)
    )).scalars().all()
    stale_count = (await db.execute(
        select(func.count(Partner.id))
        .where(
            and_(
                Partner.status == "active",
                Partner.id.notin_(active_partner_ids) if active_partner_ids else True,
            )
        )
    )).scalar() or 0

    return {
        "by_stage": stage_counts,
        "recent_interactions_30d": recent_interactions,
        "upcoming_meetings_30d": upcoming_meetings,
        "overdue_followups": overdue_count,
        "stale_active_partners": stale_count,
    }


@router.get("/upcoming-contacts")
async def upcoming_contacts(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partners that have a next_contact_date within the next N days."""
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days)

    subq = (
        select(
            PartnerUpdate.partner_id,
            func.max(PartnerUpdate.next_contact_date).label("next_contact_date"),
        )
        .where(
            PartnerUpdate.next_contact_date.isnot(None),
            PartnerUpdate.next_contact_date <= cutoff,
        )
        .group_by(PartnerUpdate.partner_id)
        .subquery()
    )

    q = (
        select(Partner, subq.c.next_contact_date)
        .join(subq, Partner.id == subq.c.partner_id)
        .order_by(subq.c.next_contact_date)
    )
    rows = (await db.execute(q)).all()

    results = []
    for partner, next_dt in rows:
        d = _partner_summary(partner, next_dt)
        d["overdue"] = next_dt < now if next_dt else False
        results.append(d)
    return results


@router.get("/pipeline")
async def get_pipeline(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kanban pipeline — partners grouped by relationship_stage."""
    if not has_module_permission(current_user, "can_view_partners"):
        raise HTTPException(status_code=403, detail="No access to partners.")

    stages = ["prospect", "qualified", "engaged", "collaborating", "alumni"]

    # Get next contact dates in bulk
    ncd_subq = (
        select(
            PartnerUpdate.partner_id,
            func.max(PartnerUpdate.next_contact_date).label("next_contact_date"),
        )
        .where(PartnerUpdate.next_contact_date.isnot(None))
        .group_by(PartnerUpdate.partner_id)
        .subquery()
    )

    result = await db.execute(
        select(Partner, ncd_subq.c.next_contact_date)
        .outerjoin(ncd_subq, Partner.id == ncd_subq.c.partner_id)
        .order_by(desc(Partner.updated_at))
    )
    rows = result.all()

    pipeline: dict[str, list] = {s: [] for s in stages}
    for partner, next_dt in rows:
        stage = partner.relationship_stage or "prospect"
        if stage not in pipeline:
            pipeline[stage] = []
        pipeline[stage].append(_partner_summary(partner, next_dt))

    return {"stages": stages, "pipeline": pipeline}


@router.get("/")
async def list_partners(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    project_type: Optional[str] = None,
    status: Optional[str] = None,
    stage: Optional[str] = None,
    organization_id: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List and search partners with next_contact_date included."""
    if not has_module_permission(current_user, "can_view_partners"):
        raise HTTPException(status_code=403, detail="No access to partners.")

    # Subquery for latest next_contact_date per partner
    ncd_subq = (
        select(
            PartnerUpdate.partner_id,
            func.max(PartnerUpdate.next_contact_date).label("next_contact_date"),
        )
        .where(PartnerUpdate.next_contact_date.isnot(None))
        .group_by(PartnerUpdate.partner_id)
        .subquery()
    )

    stmt = (
        select(Partner, ncd_subq.c.next_contact_date)
        .outerjoin(ncd_subq, Partner.id == ncd_subq.c.partner_id)
    )

    if status:
        stmt = stmt.where(Partner.status == status)
    if stage:
        stmt = stmt.where(Partner.relationship_stage == stage)
    if organization_id:
        stmt = stmt.where(Partner.organization_id == organization_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Partner.name.ilike(like),
                Partner.email.ilike(like),
                Partner.organization.ilike(like),
                Partner.title.ilike(like),
                Partner.department.ilike(like),
            )
        )
    if tag:
        stmt = stmt.where(Partner.tags.contains([tag]))
    if project_type:
        stmt = stmt.where(Partner.project_types.contains([project_type]))

    stmt = stmt.order_by(desc(Partner.updated_at)).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return [_partner_summary(p, next_dt) for p, next_dt in result.all()]


@router.post("/", status_code=201)
async def create_partner(
    data: PartnerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = Partner(
        id=str(uuid.uuid4()),
        created_by=current_user.id,
        institution_id=getattr(current_user, "institution_id", None),
        **data.model_dump(),
    )
    db.add(partner)
    await db.commit()
    await db.refresh(partner)
    return {"id": partner.id}


@router.get("/{partner_id}")
async def get_partner(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full partner detail including contact log, linked grants, meetings, and documents."""
    partner = await _get_partner_or_404(partner_id, db)

    updates = (await db.execute(
        select(PartnerUpdate)
        .where(PartnerUpdate.partner_id == partner_id)
        .order_by(desc(PartnerUpdate.created_at))
    )).scalars().all()

    links = (await db.execute(
        select(PartnerGrantLink)
        .where(PartnerGrantLink.partner_id == partner_id)
        .order_by(desc(PartnerGrantLink.created_at))
    )).scalars().all()

    # Meetings — import here to avoid circular import
    from app.models.partner_meeting import PartnerMeeting
    from app.models.partner_document import PartnerDocument

    meetings = (await db.execute(
        select(PartnerMeeting)
        .where(PartnerMeeting.partner_id == partner_id)
        .order_by(PartnerMeeting.scheduled_at.desc().nullslast())
    )).scalars().all()

    documents = (await db.execute(
        select(PartnerDocument)
        .where(PartnerDocument.partner_id == partner_id)
        .order_by(desc(PartnerDocument.created_at))
    )).scalars().all()

    # Org info
    org_info = None
    if partner.organization_id:
        from app.models.partner_organization import PartnerOrganization
        org_res = await db.execute(select(PartnerOrganization).where(PartnerOrganization.id == partner.organization_id))
        org = org_res.scalar_one_or_none()
        if org:
            org_info = {"id": org.id, "name": org.name, "org_type": org.org_type, "country": org.country, "city": org.city}

    latest_next_contact = max(
        (u.next_contact_date for u in updates if u.next_contact_date),
        default=None,
    )

    return {
        **_partner_full(partner),
        "updates": [_update_dict(u) for u in updates],
        "grant_links": [_link_dict(lnk) for lnk in links],
        "meetings": [_meeting_summary(m) for m in meetings],
        "documents": [_document_summary(d) for d in documents],
        "org_info": org_info,
        "next_contact_date": str(latest_next_contact) if latest_next_contact else None,
    }


def _meeting_summary(m) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "scheduled_at": str(m.scheduled_at) if m.scheduled_at else None,
        "duration_minutes": m.duration_minutes,
        "location": m.location,
        "meeting_type": m.meeting_type,
        "agenda": m.agenda,
        "notes": m.notes,
        "action_items": m.action_items,
        "attendees": m.attendees,
        "grant_context_entity_type": m.grant_context_entity_type,
        "grant_context_entity_id": m.grant_context_entity_id,
        "meeting_prep": m.meeting_prep,
        "meeting_prep_generated_at": str(m.meeting_prep_generated_at) if m.meeting_prep_generated_at else None,
        "reminder_at": str(m.reminder_at) if m.reminder_at else None,
        "completed_at": str(m.completed_at) if m.completed_at else None,
        "created_by": m.created_by,
        "created_at": str(m.created_at) if m.created_at else None,
    }


def _document_summary(d) -> dict:
    return {
        "id": d.id,
        "document_type": d.document_type,
        "filename": d.filename,
        "file_url": d.file_url,
        "file_size": d.file_size,
        "expertise_extracted": d.expertise_extracted,
        "created_at": str(d.created_at) if d.created_at else None,
    }


@router.patch("/{partner_id}")
async def update_partner(
    partner_id: str,
    data: PartnerUpdateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = await _get_partner_or_404(partner_id, db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(partner, k, v)
    await db.commit()
    return {"id": partner.id}


@router.patch("/{partner_id}/stage")
async def update_stage(
    partner_id: str,
    data: StageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a partner's relationship stage (used by kanban drag-and-drop)."""
    valid_stages = {"prospect", "qualified", "engaged", "collaborating", "alumni"}
    if data.relationship_stage not in valid_stages:
        raise HTTPException(400, f"Invalid stage. Must be one of: {', '.join(valid_stages)}")
    partner = await _get_partner_or_404(partner_id, db)
    partner.relationship_stage = data.relationship_stage
    await db.commit()
    return {"id": partner.id, "relationship_stage": data.relationship_stage}


@router.delete("/{partner_id}", status_code=204)
async def delete_partner(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = await _get_partner_or_404(partner_id, db)
    await db.delete(partner)
    await db.commit()


# ── Enrichment ────────────────────────────────────────────────────────────────

@router.post("/{partner_id}/enrich")
async def enrich_partner(
    partner_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger background profile enrichment via Tavily + OpenAlex."""
    partner = await _get_partner_or_404(partner_id, db)
    partner.enrichment_status = "pending"
    await db.commit()

    background_tasks.add_task(_run_enrichment, partner_id)
    return {"status": "enrichment_queued", "partner_id": partner_id}


async def _run_enrichment(partner_id: str) -> None:
    """Background enrichment — runs in FastAPI background task."""
    from app.ai.agents.partner_enrichment_agent import enrich_partner_profile

    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from app.config import get_settings
        settings = get_settings()
        engine = create_engine(settings.database_url, pool_pre_ping=True)
        with Session(engine) as db:
            partner = db.get(Partner, partner_id)
            if not partner:
                return
            partner_data = {
                "name": partner.name,
                "organization": partner.organization,
                "email": partner.email,
                "orcid": partner.orcid,
                "linkedin_url": partner.linkedin_url,
                "title": partner.title,
            }

        import asyncio
        result = asyncio.run(enrich_partner_profile(**partner_data))

        with Session(engine) as db:
            partner = db.get(Partner, partner_id)
            if not partner:
                return
            if result.get("h_index"):
                partner.h_index = result["h_index"]
            if result.get("enrichment_source"):
                partner.enrichment_source = result["enrichment_source"]
            if result.get("expertise_tags") and not partner.tags:
                partner.tags = result["expertise_tags"][:10]
            partner.enrichment_status = "done"
            partner.last_enriched_at = datetime.now(timezone.utc)
            db.commit()
    except Exception:
        try:
            with Session(engine) as db:  # type: ignore
                partner = db.get(Partner, partner_id)
                if partner:
                    partner.enrichment_status = "failed"
                    db.commit()
        except Exception:
            pass


# ── AI: fit scores ─────────────────────────────────────────────────────────────

@router.get("/{partner_id}/fit-scores")
async def get_partner_fit_scores(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return open grants/opportunities and score how well this partner fits each."""
    partner = await _get_partner_or_404(partner_id, db)

    from app.models.active_grant import ActiveGrant
    from app.models.opportunity import Opportunity

    grants_res = await db.execute(
        select(ActiveGrant)
        .where(ActiveGrant.status.in_(["submitted", "shortlisted", "active", "in_preparation"]))
        .order_by(desc(ActiveGrant.updated_at))
        .limit(20)
    )
    grants = grants_res.scalars().all()

    partner_tags = " ".join(partner.tags + partner.project_types)
    partner_context = f"{partner.name} — {partner.title or ''} at {partner.organization or ''} | Expertise: {partner_tags}"

    scores = []
    for g in grants:
        grant_tags = " ".join(getattr(g, "thematic_areas", None) or [])
        scores.append({
            "entity_type": "grant",
            "entity_id": g.id,
            "title": g.title,
            "funder": getattr(g, "funder_name", "") or "",
            "status": g.status,
            "match_signal": _simple_tag_overlap(partner.tags + partner.project_types, grant_tags.split()),
        })

    scores.sort(key=lambda x: x["match_signal"], reverse=True)
    return {"partner": {"id": partner.id, "name": partner.name}, "scores": scores[:15]}


def _simple_tag_overlap(partner_tags: list[str], grant_terms: list[str]) -> float:
    if not partner_tags or not grant_terms:
        return 0.0
    pt = {t.lower() for t in partner_tags}
    gt = {t.lower() for t in grant_terms}
    overlap = len(pt & gt)
    return round(overlap / max(len(pt), 1), 2)


# ── AI: outreach email draft ───────────────────────────────────────────────────

@router.post("/{partner_id}/draft-outreach")
async def draft_outreach_email(
    partner_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a personalized outreach email draft using AI."""
    partner = await _get_partner_or_404(partner_id, db)

    from app.ai.agents.outreach_draft_agent import draft_outreach_email as draft_fn
    from app.models.institution import Institution

    institution = None
    if current_user.institution_id:
        inst_res = await db.execute(select(Institution).where(Institution.id == current_user.institution_id))
        institution = inst_res.scalar_one_or_none()

    result = await draft_fn(
        partner_name=partner.name,
        partner_title=partner.title,
        partner_organization=partner.organization,
        partner_tags=partner.tags,
        purpose=data.get("purpose", ""),
        grant_context=data.get("grant_context", ""),
        sender_name=current_user.name,
        sender_institution=institution.name if institution else "",
    )
    return result


# ── AI: discover new partners ──────────────────────────────────────────────────

@router.get("/search-discover")
async def discover_partners(
    q: str,
    institution_type: Optional[str] = None,
    country: Optional[str] = None,
    max_results: int = 10,
    current_user: User = Depends(get_current_user),
):
    """Search for potential new partners via Tavily + OpenAlex."""
    from app.ai.agents.partner_discovery_agent import discover_partners as discover_fn
    result = await discover_fn(
        query=q,
        institution_type=institution_type,
        country=country,
        max_results=max_results,
    )
    return result


# ── Contact log sub-resource ──────────────────────────────────────────────────

@router.get("/{partner_id}/updates")
async def list_partner_updates(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_partner_or_404(partner_id, db)
    q = (
        select(PartnerUpdate)
        .where(PartnerUpdate.partner_id == partner_id)
        .order_by(desc(PartnerUpdate.created_at))
    )
    updates = (await db.execute(q)).scalars().all()
    return [_update_dict(u) for u in updates]


@router.post("/{partner_id}/updates", status_code=201)
async def add_partner_update(
    partner_id: str,
    data: ContactLogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_partner_or_404(partner_id, db)
    update = PartnerUpdate(
        id=str(uuid.uuid4()),
        partner_id=partner_id,
        user_id=current_user.id,
        **data.model_dump(),
    )
    db.add(update)
    await db.commit()
    await db.refresh(update)
    return _update_dict(update)


# ── Grant/opportunity link sub-resource ───────────────────────────────────────

@router.get("/{partner_id}/links")
async def list_partner_links(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_partner_or_404(partner_id, db)
    q = (
        select(PartnerGrantLink)
        .where(PartnerGrantLink.partner_id == partner_id)
        .order_by(desc(PartnerGrantLink.created_at))
    )
    links = (await db.execute(q)).scalars().all()
    return [_link_dict(lnk) for lnk in links]


@router.post("/{partner_id}/links", status_code=201)
async def add_partner_link(
    partner_id: str,
    data: PartnerLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_partner_or_404(partner_id, db)
    link = PartnerGrantLink(
        id=str(uuid.uuid4()),
        partner_id=partner_id,
        created_by=current_user.id,
        **data.model_dump(),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _link_dict(link)


@router.get("/{partner_id}/workspace-sync-status")
async def workspace_sync_status(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check if this CRM partner matches any workspace partners by email."""
    partner = await _get_partner_or_404(partner_id, db)
    if not partner.email:
        return {"matches": []}

    from app.models.workspace_partner import WorkspacePartner
    from app.models.active_grant import ActiveGrant

    res = await db.execute(
        select(WorkspacePartner, ActiveGrant)
        .join(ActiveGrant, ActiveGrant.id == WorkspacePartner.grant_id)
        .where(WorkspacePartner.email == partner.email)
    )
    rows = res.all()
    matches = []
    for wp, grant in rows:
        matches.append({
            "workspace_partner_id": wp.id,
            "grant_id": grant.id,
            "grant_title": grant.title,
            "role": wp.role,
            "status": wp.status,
            "institution_name": wp.institution_name,
        })
    return {"matches": matches, "partner_email": partner.email}


@router.delete("/{partner_id}/links/{link_id}", status_code=204)
async def delete_partner_link(
    partner_id: str,
    link_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PartnerGrantLink).where(
            PartnerGrantLink.id == link_id,
            PartnerGrantLink.partner_id == partner_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.commit()
