"""CRM Partners endpoints — full contact management, meetings, documents, AI enrichment."""
import csv
import io
import uuid
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, or_, func, and_, cast, String
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
    owner_id: Optional[str] = None
    priority: int = Field(1, ge=1, le=3)


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
    owner_id: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=3)


class BulkUpdateSchema(BaseModel):
    ids: list[str]
    relationship_stage: Optional[str] = None
    owner_id: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=3)


class BulkDeleteSchema(BaseModel):
    ids: list[str]


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

def _partner_summary(
    p: Partner,
    next_contact_date: datetime | None = None,
    owner_name: str | None = None,
) -> dict:
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
        "owner_id": p.owner_id,
        "owner_name": owner_name,
        "priority": p.priority or 1,
    }


def _partner_full(p: Partner, owner_name: str | None = None) -> dict:
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
        "bio": p.bio,
        "enrichment_sources": p.enrichment_sources or [],
        "priority": p.priority or 1,
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
        "owner_id": p.owner_id,
        "owner_name": owner_name,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }
    return d


def _update_dict(u: PartnerUpdate, user_name: str | None = None) -> dict:
    return {
        "id": u.id,
        "partner_id": u.partner_id,
        "user_id": u.user_id,
        "user_name": user_name,
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


@router.get("/home")
async def partners_home(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Counts for the Partners header."""
    if not has_module_permission(current_user, "can_view_partners"):
        raise HTTPException(status_code=403, detail="No access to partners.")
    from app.models.partner_group import PartnerGroup

    people = (await db.execute(select(func.count(Partner.id)))).scalar() or 0
    inst = getattr(current_user, "institution_id", None)
    groups = (await db.execute(select(func.count(PartnerGroup.id)).where(
        PartnerGroup.institution_id == inst if inst else PartnerGroup.institution_id.is_(None)
    ))).scalar() or 0
    return {"counts": {"people": people, "groups": groups}}


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
    owner_id: Optional[str] = None,
    owner_me: Optional[bool] = None,
    overdue: Optional[bool] = None,
    days_inactive: Optional[int] = None,
    priority: Optional[int] = None,
    group_id: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = "desc",
    limit: int = 200,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List and search partners with next_contact_date included."""
    if not has_module_permission(current_user, "can_view_partners"):
        raise HTTPException(status_code=403, detail="No access to partners.")

    now = datetime.now(timezone.utc)

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
    if owner_id:
        stmt = stmt.where(Partner.owner_id == owner_id)
    if owner_me:
        stmt = stmt.where(Partner.owner_id == current_user.id)
    if overdue:
        stmt = stmt.where(ncd_subq.c.next_contact_date < now)
    if days_inactive:
        cutoff = now - timedelta(days=days_inactive)
        # Subquery: last interaction date
        last_active_subq = (
            select(PartnerUpdate.partner_id, func.max(PartnerUpdate.created_at).label("last_active"))
            .group_by(PartnerUpdate.partner_id)
            .subquery()
        )
        stmt = stmt.outerjoin(last_active_subq, Partner.id == last_active_subq.c.partner_id)
        stmt = stmt.where(
            or_(last_active_subq.c.last_active.is_(None), last_active_subq.c.last_active < cutoff)
        )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Partner.name.ilike(like),
                Partner.email.ilike(like),
                Partner.organization.ilike(like),
                Partner.title.ilike(like),
                Partner.department.ilike(like),
                cast(Partner.tags, String).ilike(like),
            )
        )
    if priority:
        stmt = stmt.where(Partner.priority == priority)
    if group_id:
        from app.models.partner_group import PartnerGroupMember
        stmt = stmt.where(Partner.id.in_(
            select(PartnerGroupMember.partner_id).where(PartnerGroupMember.group_id == group_id)))
    if tag:
        stmt = stmt.where(Partner.tags.contains([tag]))
    if project_type:
        stmt = stmt.where(Partner.project_types.contains([project_type]))

    # Sorting
    sort_col = {
        "name": Partner.name,
        "organization": Partner.organization,
        "stage": Partner.relationship_stage,
        "last_contact": Partner.updated_at,
        "next_contact": ncd_subq.c.next_contact_date,
        "created": Partner.created_at,
        "priority": Partner.priority,
    }.get(sort_by or "last_contact", Partner.updated_at)

    if sort_dir == "asc":
        stmt = stmt.order_by(sort_col.asc().nullslast())
    else:
        stmt = stmt.order_by(sort_col.desc().nullslast())

    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    rows = result.all()

    # Resolve owner names in bulk
    owner_ids = list({p.owner_id for p, _ in rows if p.owner_id})
    owner_name_map: dict[str, str] = {}
    if owner_ids:
        users = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owner_name_map = {u.id: u.name for u in users}

    out = [_partner_summary(p, ncd, owner_name_map.get(p.owner_id or "")) for p, ncd in rows]
    await _attach_engagement(out, db)
    return out


async def _attach_engagement(items: list[dict], db: AsyncSession) -> None:
    """Add each partner's groups, last contact and 12-week activity strip."""
    from app.services.partner_engagement import last_touch_map, weekly_by_partner, WEEKS
    ids = [d["id"] for d in items]
    groups = await _groups_by_partner(ids, db)
    last = await last_touch_map(db, ids)
    weeks = await weekly_by_partner(db, ids)
    for d in items:
        d["groups"] = groups.get(d["id"], [])
        lt = last.get(d["id"])
        d["last_touch"] = lt.isoformat() if lt else None
        d["weeks"] = weeks.get(d["id"], [0] * WEEKS)


async def _groups_by_partner(ids: list[str], db: AsyncSession) -> dict[str, list[dict]]:
    from app.models.partner_group import PartnerGroup, PartnerGroupMember
    if not ids:
        return {}
    rows = (await db.execute(
        select(PartnerGroupMember.partner_id, PartnerGroup.id, PartnerGroup.name, PartnerGroup.color)
        .join(PartnerGroup, PartnerGroup.id == PartnerGroupMember.group_id)
        .where(PartnerGroupMember.partner_id.in_(ids))
        .order_by(PartnerGroup.name)
    )).all()
    out: dict[str, list[dict]] = {}
    for pid, gid, name, color in rows:
        out.setdefault(pid, []).append({"id": gid, "name": name, "color": color})
    return out


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


# ── Reach-out reminders (replaces follow-up/status) ───────────────────────────

class ReminderCreate(BaseModel):
    scheduled_for: datetime
    title: str
    description: Optional[str] = None


@router.post("/{partner_id}/reminders", status_code=201)
async def create_partner_reminder(
    partner_id: str, data: ReminderCreate,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    from app.models.partner_reminder import PartnerReminder
    await _get_partner_or_404(partner_id, db)
    r = PartnerReminder(
        id=str(uuid.uuid4()), partner_id=partner_id, user_id=current_user.id,
        institution_id=getattr(current_user, "institution_id", None),
        reminder_type="reach_out", title=data.title, description=data.description,
        scheduled_for=data.scheduled_for,
    )
    db.add(r)
    await db.commit()
    return {"id": r.id}


@router.get("/{partner_id}/reminders")
async def list_partner_reminders(
    partner_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    from app.models.partner_reminder import PartnerReminder
    rows = (await db.execute(
        select(PartnerReminder).where(
            PartnerReminder.partner_id == partner_id,
            PartnerReminder.dismissed_at.is_(None),
        ).order_by(PartnerReminder.scheduled_for)
    )).scalars().all()
    return [{
        "id": r.id, "title": r.title, "description": r.description,
        "scheduled_for": r.scheduled_for.isoformat() if r.scheduled_for else None,
        "sent_at": r.sent_at.isoformat() if r.sent_at else None,
    } for r in rows]


@router.delete("/{partner_id}/reminders/{reminder_id}", status_code=204)
async def delete_partner_reminder(
    partner_id: str, reminder_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    from sqlalchemy import delete as sa_delete
    from app.models.partner_reminder import PartnerReminder
    await db.execute(sa_delete(PartnerReminder).where(
        PartnerReminder.id == reminder_id, PartnerReminder.partner_id == partner_id))
    await db.commit()


# ── Bulk add from a pasted list of emails (parse → create → research each) ────

class EmailListIn(BaseModel):
    text: str


class EmailContactIn(BaseModel):
    email: str
    name: str
    name_guessed: bool = False
    priority: Optional[int] = Field(None, ge=1, le=3)


class BulkFromEmailsIn(BaseModel):
    contacts: list[EmailContactIn]
    research: bool = True
    group_ids: list[str] = []
    tags: list[str] = []
    priority: int = Field(1, ge=1, le=3)


class IdsIn(BaseModel):
    ids: list[str]


@router.post("/parse-email-list")
async def parse_email_list_preview(
    data: EmailListIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Parse a pasted To:/Cc: list (or any text with addresses) into contacts,
    flagging ones already in the CRM and the current user's own address."""
    from app.services.email_list_parser import parse_email_list

    contacts = parse_email_list(data.text)
    if len(contacts) > 500:
        raise HTTPException(400, "That's more than 500 addresses — split the list and paste it in parts.")
    emails = [c.email for c in contacts]
    existing: dict[str, Partner] = {}
    if emails:
        rows = (await db.execute(select(Partner).where(func.lower(Partner.email).in_(emails)))).scalars().all()
        existing = {(p.email or "").lower(): p for p in rows}
    me = (current_user.email or "").lower()
    out = []
    for c in contacts:
        hit = existing.get(c.email)
        out.append({
            **c.to_dict(),
            "is_self": c.email == me,
            "existing_partner_id": hit.id if hit else None,
            "existing_name": hit.name if hit else None,
        })
    return {"contacts": out}


@router.post("/bulk-from-emails", status_code=201)
async def bulk_create_from_emails(
    data: BulkFromEmailsIn, background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Create a partner for each contact (skipping emails already in the CRM),
    then research each one on the web in the background to fill in title,
    organization, bio, expertise and links. Poll /research-status for progress."""
    if len(data.contacts) > 500:
        raise HTTPException(400, "At most 500 contacts per batch.")
    emails = [c.email.strip().lower() for c in data.contacts]
    taken = set()
    if emails:
        taken = {
            (e or "").lower() for e in (await db.execute(
                select(Partner.email).where(func.lower(Partner.email).in_(emails))
            )).scalars().all()
        }

    # Tags chosen on import go on everyone; de-duplicated case-insensitively.
    tags: list[str] = []
    for t in data.tags:
        t = t.strip()[:100]
        if t and t.lower() not in {x.lower() for x in tags}:
            tags.append(t)

    created: list[dict] = []
    skipped: list[str] = []
    queue: list[tuple[str, bool]] = []
    for c in data.contacts:
        email = c.email.strip().lower()
        if not email or email in taken:
            skipped.append(email)
            continue
        taken.add(email)
        p = Partner(
            id=str(uuid.uuid4()), created_by=current_user.id,
            institution_id=getattr(current_user, "institution_id", None),
            name=(c.name or email).strip()[:300], email=email, tags=list(tags),
            priority=c.priority or data.priority,
            enrichment_status="pending" if data.research else "none",
        )
        db.add(p)
        created.append({"id": p.id, "name": p.name, "email": email})
        queue.append((p.id, c.name_guessed))
    await db.flush()
    if data.group_ids and created:
        from app.services.partner_groups import add_members
        for gid in data.group_ids:
            await add_members(db, gid, [c["id"] for c in created], current_user.id)
    await db.commit()

    if data.research and queue:
        _queue_research(queue, background_tasks)
    return {"created": created, "skipped_existing": skipped}


@router.post("/research-status")
async def research_status(
    data: IdsIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Progress for a batch of partners being researched."""
    if not data.ids:
        return []
    rows = (await db.execute(select(Partner).where(Partner.id.in_(data.ids[:500])))).scalars().all()
    return [{
        "id": p.id, "name": p.name, "email": p.email, "title": p.title,
        "organization": p.organization, "enrichment_status": p.enrichment_status,
        "has_bio": bool(p.bio),
    } for p in rows]


def _queue_research(items: list[tuple[str, bool]], background_tasks: BackgroundTasks) -> None:
    """Start web research for these partners inside the API process, 4 at a
    time. Not Celery: the production worker runs one job at a time behind the
    discovery backlog, so queued research could sit on "Researching…" for
    hours. See app.services.partner_research.start_research."""
    from app.services.partner_research import start_research
    start_research(items)


# ── Bulk CSV import ───────────────────────────────────────────────────────────

@router.post("/import-csv")
async def import_partners_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Import partners from a CSV with columns name,email,organization,title,tags
    (tags separated by ; or ,)."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    text = raw.decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))

    def g(row: dict, *keys: str) -> Optional[str]:
        for k in keys:
            v = row.get(k) or row.get(k.capitalize()) or row.get(k.upper())
            if v and str(v).strip():
                return str(v).strip()
        return None

    created = 0
    for row in reader:
        name = g(row, "name")
        if not name:
            continue
        tags_raw = g(row, "tags") or ""
        sep = ";" if ";" in tags_raw else ","
        tags = [t.strip() for t in tags_raw.split(sep) if t.strip()]
        db.add(Partner(
            id=str(uuid.uuid4()), created_by=current_user.id,
            institution_id=getattr(current_user, "institution_id", None),
            name=name, email=g(row, "email"), organization=g(row, "organization", "org"),
            title=g(row, "title"), tags=tags,
        ))
        created += 1
    await db.commit()
    return {"created": created}


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

    # Resolve user names for updates in one query
    user_ids = list({u.user_id for u in updates if u.user_id})
    user_name_map: dict[str, str] = {}
    if user_ids:
        users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        user_name_map = {u.id: u.name for u in users}

    # Resolve owner name
    owner_name: str | None = None
    if partner.owner_id:
        owner = (await db.execute(select(User).where(User.id == partner.owner_id))).scalar_one_or_none()
        if owner:
            owner_name = owner.name

    # Resolve grant/opportunity titles for links
    from app.models.active_grant import ActiveGrant
    from app.models.opportunity import Opportunity

    grant_ids = [lnk.entity_id for lnk in links if lnk.entity_type == "grant"]
    opp_ids = [lnk.entity_id for lnk in links if lnk.entity_type == "opportunity"]
    entity_titles: dict[str, str] = {}
    if grant_ids:
        grant_rows = (await db.execute(select(ActiveGrant.id, ActiveGrant.title).where(ActiveGrant.id.in_(grant_ids)))).all()
        entity_titles.update({r.id: r.title for r in grant_rows})
    if opp_ids:
        opp_rows = (await db.execute(select(Opportunity.id, Opportunity.title).where(Opportunity.id.in_(opp_ids)))).all()
        entity_titles.update({r.id: r.title for r in opp_rows})

    def _link_dict_with_title(lnk: PartnerGrantLink) -> dict:
        d = _link_dict(lnk)
        d["entity_title"] = entity_titles.get(lnk.entity_id)
        return d

    # Task count
    from app.models.partner_task import PartnerTask
    task_count = (await db.execute(
        select(func.count(PartnerTask.id))
        .where(PartnerTask.partner_id == partner_id, PartnerTask.status.in_(["open", "in_progress"]))
    )).scalar() or 0

    latest_next_contact = max(
        (u.next_contact_date for u in updates if u.next_contact_date),
        default=None,
    )

    return {
        **_partner_full(partner, owner_name=owner_name),
        "task_count": task_count,
        "updates": [_update_dict(u, user_name_map.get(u.user_id or "")) for u in updates],
        "grant_links": [_link_dict_with_title(lnk) for lnk in links],
        "meetings": [_meeting_summary(m) for m in meetings],
        "documents": [_document_summary(d) for d in documents],
        "org_info": org_info,
        "next_contact_date": str(latest_next_contact) if latest_next_contact else None,
        "groups": (await _groups_by_partner([partner.id], db)).get(partner.id, []),
        **(await _engagement_detail(partner.id, db)),
    }


async def _engagement_detail(partner_id: str, db: AsyncSession) -> dict:
    from app.services.partner_engagement import touch_events, week_index, now_utc, WEEKS
    now = now_utc()
    events = await touch_events(db, [partner_id], since=now - timedelta(days=90))
    weeks = [0] * WEEKS
    kinds: dict[str, int] = {}
    for _, ts, kind in events:
        if (i := week_index(ts, now)) is not None:
            weeks[i] += 1
        kinds[kind] = kinds.get(kind, 0) + 1
    last = await touch_events(db, [partner_id])
    return {
        "last_touch": last[0][1].isoformat() if last else None,
        "last_touch_kind": last[0][2] if last else None,
        "weeks": weeks,
        "touches_90d": len(events),
        "touches_90d_by_kind": kinds,
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
    """Research this partner on the web (search, profile pages, OpenAlex) in the
    background and fill in empty fields, bio and expertise tags."""
    partner = await _get_partner_or_404(partner_id, db)
    partner.enrichment_status = "pending"
    await db.commit()

    _queue_research([(partner_id, False)], background_tasks)
    return {"status": "enrichment_queued", "partner_id": partner_id}


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
    updates = (await db.execute(
        select(PartnerUpdate)
        .where(PartnerUpdate.partner_id == partner_id)
        .order_by(desc(PartnerUpdate.created_at))
    )).scalars().all()

    user_ids = list({u.user_id for u in updates if u.user_id})
    user_name_map: dict[str, str] = {}
    if user_ids:
        users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        user_name_map = {u.id: u.name for u in users}

    return [_update_dict(u, user_name_map.get(u.user_id or "")) for u in updates]


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


# ── Entity search (for grant linking) ─────────────────────────────────────────

@router.get("/entity-search")
async def entity_search(
    q: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search grants and opportunities by title for the entity link picker."""
    from app.models.active_grant import ActiveGrant
    from app.models.opportunity import Opportunity

    like = f"%{q}%"
    results = []

    # Search active grants
    grant_rows = (await db.execute(
        select(ActiveGrant)
        .where(or_(ActiveGrant.title.ilike(like), ActiveGrant.funder_name.ilike(like)))
        .order_by(desc(ActiveGrant.updated_at))
        .limit(limit // 2 + 5)
    )).scalars().all()
    for g in grant_rows:
        results.append({
            "id": g.id,
            "type": "grant",
            "title": g.title,
            "funder": getattr(g, "funder_name", None),
            "status": g.status,
            "deadline": None,
        })

    # Search opportunities
    opp_rows = (await db.execute(
        select(Opportunity)
        .where(or_(Opportunity.title.ilike(like), Opportunity.funder.ilike(like)))
        .order_by(desc(Opportunity.updated_at))
        .limit(limit // 2 + 5)
    )).scalars().all()
    for o in opp_rows:
        results.append({
            "id": o.id,
            "type": "opportunity",
            "title": o.title,
            "funder": getattr(o, "funder", None),
            "status": getattr(o, "status", None),
            "deadline": str(o.deadline) if getattr(o, "deadline", None) else None,
        })

    return results[:limit]


# ── CSV export ─────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_partners(
    format: str = "csv",
    status: Optional[str] = None,
    stage: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export partner list as CSV."""
    stmt = select(Partner)
    if status:
        stmt = stmt.where(Partner.status == status)
    if stage:
        stmt = stmt.where(Partner.relationship_stage == stage)
    stmt = stmt.order_by(Partner.name)
    partners = (await db.execute(stmt)).scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Name", "Email", "Phone", "Organization", "Title", "Department",
        "Country", "City", "Stage", "Status", "Tags", "Project Types",
        "H-Index", "ORCID", "LinkedIn", "Website", "Owner ID", "Created At",
    ])
    for p in partners:
        writer.writerow([
            p.name, p.email or "", p.phone or "", p.organization or "",
            p.title or "", p.department or "", p.country or "", p.city or "",
            p.relationship_stage, p.status,
            "|".join(p.tags or []), "|".join(p.project_types or []),
            p.h_index or "", p.orcid or "", p.linkedin_url or "", p.website or "",
            p.owner_id or "",
            str(p.created_at) if p.created_at else "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=partners.csv"},
    )


# ── Bulk operations ────────────────────────────────────────────────────────────

@router.post("/bulk-update")
async def bulk_update_partners(
    data: BulkUpdateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk update stage / owner / status for a list of partner IDs."""
    if not data.ids:
        return {"updated": 0}
    partners = (await db.execute(select(Partner).where(Partner.id.in_(data.ids)))).scalars().all()
    fields = data.model_dump(exclude={"ids"}, exclude_none=True)
    for p in partners:
        for k, v in fields.items():
            setattr(p, k, v)
    await db.commit()
    return {"updated": len(partners)}


@router.post("/bulk-delete")
async def bulk_delete_partners(
    data: BulkDeleteSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk delete partners by ID list."""
    if not data.ids:
        return {"deleted": 0}
    partners = (await db.execute(select(Partner).where(Partner.id.in_(data.ids)))).scalars().all()
    for p in partners:
        await db.delete(p)
    await db.commit()
    return {"deleted": len(partners)}


# ── Update edit/delete ─────────────────────────────────────────────────────────

@router.patch("/{partner_id}/updates/{update_id}")
async def edit_partner_update(
    partner_id: str,
    update_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    upd = (await db.execute(
        select(PartnerUpdate).where(PartnerUpdate.id == update_id, PartnerUpdate.partner_id == partner_id)
    )).scalar_one_or_none()
    if not upd:
        raise HTTPException(404, "Update not found")
    if "content" in data:
        upd.content = data["content"]
    await db.commit()
    return _update_dict(upd)


@router.delete("/{partner_id}/updates/{update_id}", status_code=204)
async def delete_partner_update(
    partner_id: str,
    update_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    upd = (await db.execute(
        select(PartnerUpdate).where(PartnerUpdate.id == update_id, PartnerUpdate.partner_id == partner_id)
    )).scalar_one_or_none()
    if not upd:
        raise HTTPException(404, "Update not found")
    await db.delete(upd)
    await db.commit()


# ── Unified activity feed ──────────────────────────────────────────────────────

@router.get("/{partner_id}/activity")
async def get_partner_activity(
    partner_id: str,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unified activity feed merging updates, meetings, and documents."""
    await _get_partner_or_404(partner_id, db)
    from app.models.partner_meeting import PartnerMeeting
    from app.models.partner_document import PartnerDocument

    updates = (await db.execute(
        select(PartnerUpdate).where(PartnerUpdate.partner_id == partner_id)
    )).scalars().all()

    meetings = (await db.execute(
        select(PartnerMeeting).where(PartnerMeeting.partner_id == partner_id)
    )).scalars().all()

    documents = (await db.execute(
        select(PartnerDocument).where(PartnerDocument.partner_id == partner_id)
    )).scalars().all()

    # Resolve user names
    user_ids = list({u.user_id for u in updates if u.user_id})
    user_name_map: dict[str, str] = {}
    if user_ids:
        users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        user_name_map = {u.id: u.name for u in users}

    activity: list[dict] = []
    for u in updates:
        activity.append({
            "activity_type": "update",
            "id": u.id,
            "type": u.update_type,
            "content": u.content,
            "user_id": u.user_id,
            "user_name": user_name_map.get(u.user_id or ""),
            "date": (u.contact_date or u.created_at).isoformat() if (u.contact_date or u.created_at) else None,
            "next_contact_date": str(u.next_contact_date) if u.next_contact_date else None,
        })

    for m in meetings:
        activity.append({
            "activity_type": "meeting",
            "id": m.id,
            "title": m.title,
            "meeting_type": m.meeting_type,
            "scheduled_at": str(m.scheduled_at) if m.scheduled_at else None,
            "completed_at": str(m.completed_at) if m.completed_at else None,
            "date": (m.scheduled_at or m.created_at).isoformat() if (m.scheduled_at or m.created_at) else None,
        })

    for d in documents:
        activity.append({
            "activity_type": "document",
            "id": d.id,
            "document_type": d.document_type,
            "filename": d.filename,
            "date": d.created_at.isoformat() if d.created_at else None,
        })

    # Sort by date descending
    activity.sort(key=lambda x: x.get("date") or "", reverse=True)
    return activity[offset:offset + limit]


# ── Duplicate detection ────────────────────────────────────────────────────────

@router.get("/{partner_id}/possible-duplicates")
async def find_possible_duplicates(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find partners that may be duplicates based on email or name+org similarity."""
    partner = await _get_partner_or_404(partner_id, db)
    candidates = []

    # Exact email match (excluding self)
    if partner.email:
        email_matches = (await db.execute(
            select(Partner)
            .where(Partner.email == partner.email, Partner.id != partner_id)
        )).scalars().all()
        for m in email_matches:
            candidates.append({**_partner_summary(m), "match_reason": "same_email", "confidence": 0.95})

    # Fuzzy name+org match using DB ilike
    if partner.name:
        name_parts = partner.name.split()
        if len(name_parts) >= 2:
            first = name_parts[0]
            last = name_parts[-1]
            name_matches = (await db.execute(
                select(Partner)
                .where(
                    Partner.id != partner_id,
                    Partner.name.ilike(f"%{first}%"),
                    Partner.name.ilike(f"%{last}%"),
                )
                .limit(5)
            )).scalars().all()
            for m in name_matches:
                if not any(c["id"] == m.id for c in candidates):
                    same_org = bool(
                        partner.organization and m.organization and
                        partner.organization.lower()[:15] in m.organization.lower()
                    )
                    candidates.append({
                        **_partner_summary(m),
                        "match_reason": "similar_name_and_org" if same_org else "similar_name",
                        "confidence": 0.75 if same_org else 0.55,
                    })

    return candidates[:10]


@router.post("/{partner_id}/merge")
async def merge_partners(
    partner_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merge another partner into this one, keeping chosen fields."""
    other_id = data.get("other_id")
    keep_fields: dict[str, str] = data.get("keep_fields", {})

    if not other_id:
        raise HTTPException(400, "other_id required")

    primary = await _get_partner_or_404(partner_id, db)
    other = await _get_partner_or_404(other_id, db)

    # Apply field choices
    mergeable = ["name", "email", "phone", "organization", "title", "department", "country", "city",
                 "linkedin_url", "website", "orcid", "google_scholar_id", "h_index", "notes"]
    for field in mergeable:
        choice = keep_fields.get(field)
        if choice == "other":
            setattr(primary, field, getattr(other, field))
        elif choice == "primary":
            pass  # keep as-is
        else:
            # Auto-merge: keep non-null value
            if not getattr(primary, field) and getattr(other, field):
                setattr(primary, field, getattr(other, field))

    # Merge tags
    primary.tags = list(set((primary.tags or []) + (other.tags or [])))
    primary.project_types = list(set((primary.project_types or []) + (other.project_types or [])))

    # Re-parent the other partner's sub-records to primary
    await db.execute(
        PartnerUpdate.__table__.update()
        .where(PartnerUpdate.partner_id == other_id)
        .values(partner_id=partner_id)
    )
    await db.execute(
        PartnerGrantLink.__table__.update()
        .where(PartnerGrantLink.partner_id == other_id)
        .values(partner_id=partner_id)
    )
    from app.models.partner_meeting import PartnerMeeting
    from app.models.partner_document import PartnerDocument
    await db.execute(
        PartnerMeeting.__table__.update()
        .where(PartnerMeeting.partner_id == other_id)
        .values(partner_id=partner_id)
    )
    await db.execute(
        PartnerDocument.__table__.update()
        .where(PartnerDocument.partner_id == other_id)
        .values(partner_id=partner_id)
    )

    # Delete the duplicate
    await db.delete(other)
    await db.commit()
    return {"merged_into": partner_id, "deleted": other_id}
