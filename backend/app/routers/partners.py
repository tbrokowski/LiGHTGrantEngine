"""CRM Partners endpoints — contact management and partner-grant linking."""
import uuid
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.partner import Partner, PartnerUpdate, PartnerGrantLink
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PartnerCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    tags: list[str] = []
    project_types: list[str] = []
    status: str = "active"
    notes: Optional[str] = None


class PartnerUpdateSchema(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    website: Optional[str] = None
    tags: Optional[list[str]] = None
    project_types: Optional[list[str]] = None
    status: Optional[str] = None
    notes: Optional[str] = None


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


# ── Helper serializers ────────────────────────────────────────────────────────

def _partner_summary(p: Partner) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "email": p.email,
        "organization": p.organization,
        "title": p.title,
        "tags": p.tags,
        "project_types": p.project_types,
        "status": p.status,
        "created_at": str(p.created_at) if p.created_at else None,
        "updated_at": str(p.updated_at) if p.updated_at else None,
    }


def _partner_full(p: Partner) -> dict:
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    for f in ["created_at", "updated_at"]:
        if d.get(f):
            d[f] = str(d[f])
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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/upcoming-contacts")
async def upcoming_contacts(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partners that have a next_contact_date within the next N days (default 30)."""
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days)

    # Get the latest update per partner that has a next_contact_date
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
        d = _partner_summary(partner)
        d["next_contact_date"] = str(next_dt) if next_dt else None
        d["overdue"] = next_dt < now if next_dt else False
        results.append(d)
    return results


@router.get("/")
async def list_partners(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    project_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List and search partners. Supports free-text search on name/email/org."""
    stmt = select(Partner)

    if status:
        stmt = stmt.where(Partner.status == status)

    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Partner.name.ilike(like),
                Partner.email.ilike(like),
                Partner.organization.ilike(like),
                Partner.title.ilike(like),
            )
        )

    # JSON array filtering for tags and project_types
    if tag:
        stmt = stmt.where(Partner.tags.contains([tag]))
    if project_type:
        stmt = stmt.where(Partner.project_types.contains([project_type]))

    stmt = stmt.order_by(desc(Partner.updated_at)).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return [_partner_summary(p) for p in result.scalars().all()]


@router.post("/", status_code=201)
async def create_partner(
    data: PartnerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = Partner(
        id=str(uuid.uuid4()),
        created_by=current_user.id,
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
    """Full partner detail including contact log and linked grants."""
    partner = await _get_partner_or_404(partner_id, db)

    updates_q = (
        select(PartnerUpdate)
        .where(PartnerUpdate.partner_id == partner_id)
        .order_by(desc(PartnerUpdate.created_at))
    )
    updates = (await db.execute(updates_q)).scalars().all()

    links_q = (
        select(PartnerGrantLink)
        .where(PartnerGrantLink.partner_id == partner_id)
        .order_by(desc(PartnerGrantLink.created_at))
    )
    links = (await db.execute(links_q)).scalars().all()

    # Determine latest next_contact_date from updates
    latest_next_contact = None
    for u in updates:
        if u.next_contact_date:
            if not latest_next_contact or u.next_contact_date > latest_next_contact:
                latest_next_contact = u.next_contact_date

    return {
        **_partner_full(partner),
        "updates": [_update_dict(u) for u in updates],
        "grant_links": [_link_dict(lnk) for lnk in links],
        "next_contact_date": str(latest_next_contact) if latest_next_contact else None,
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


@router.delete("/{partner_id}", status_code=204)
async def delete_partner(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = await _get_partner_or_404(partner_id, db)
    await db.delete(partner)
    await db.commit()


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
