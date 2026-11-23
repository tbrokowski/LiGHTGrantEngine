"""Funders tab — partners sorted into whale tiers, for organizations with the
"funders" feature on (LiGHT). A funder is a Partner with `funder_tier` set, so
the partner endpoints (contact log, tasks, meetings) work on funders as-is."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import has_module_permission, require_super_admin
from app.database import get_db
from app.models.institution import Institution
from app.models.partner import Partner, PartnerUpdate
from app.models.partner_organization import PartnerOrganization
from app.models.partner_task import PartnerTask
from app.models.user import User
from app.routers.auth import get_current_user
from app.routers.partners import _attach_engagement, _partner_summary, partner_org_filter
from app.services.funders import FEATURE, FUNDER_TIERS, ensure_seeded, has_feature, valid_tier

router = APIRouter()

OPEN = ("open", "in_progress")


def _check_tier(v: Optional[str]) -> Optional[str]:
    if v is not None and not valid_tier(v):
        raise ValueError(f"Unknown tier. Use one of: {', '.join(FUNDER_TIERS)}")
    return v


class TierIn(BaseModel):
    tier: Optional[str] = None  # None takes the person off the Funders tab

    _v = field_validator("tier")(_check_tier)


class BulkTierIn(BaseModel):
    ids: list[str]
    tier: Optional[str] = None

    _v = field_validator("tier")(_check_tier)


class FunderCreate(BaseModel):
    name: str
    tier: str = "unsorted"
    organization: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    notes: Optional[str] = None
    research: bool = True

    _v = field_validator("tier")(_check_tier)


class FeatureIn(BaseModel):
    enabled: bool


async def _funders_org(db: AsyncSession, user: User) -> Institution:
    if not has_module_permission(user, "can_view_partners"):
        raise HTTPException(403, "No access to partners.")
    inst = await db.get(Institution, user.institution_id) if user.institution_id else None
    if not has_feature(inst):
        raise HTTPException(404, "Funders isn't switched on for this organization.")
    return inst


async def _org_partner(db: AsyncSession, user: User, partner_id: str) -> Partner:
    p = (await db.execute(select(Partner).where(Partner.id == partner_id, partner_org_filter(user)))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Partner not found")
    return p


@router.get("/")
async def list_funders(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every funder in the organization with tier, organization, engagement and
    open follow-ups. The first visit loads the starter list."""
    inst = await _funders_org(db, current_user)
    await ensure_seeded(db, inst, current_user.id)

    ncd = (
        select(PartnerUpdate.partner_id, func.max(PartnerUpdate.next_contact_date).label("next_contact_date"))
        .where(PartnerUpdate.next_contact_date.isnot(None))
        .group_by(PartnerUpdate.partner_id)
        .subquery()
    )
    rows = (await db.execute(
        select(Partner, ncd.c.next_contact_date)
        .outerjoin(ncd, Partner.id == ncd.c.partner_id)
        .where(partner_org_filter(current_user), Partner.funder_tier.isnot(None))
        .order_by(Partner.name)
    )).all()

    owner_ids = {p.owner_id for p, _ in rows if p.owner_id}
    owners = dict((await db.execute(select(User.id, User.name).where(User.id.in_(owner_ids)))).all()) if owner_ids else {}
    org_ids = {p.organization_id for p, _ in rows if p.organization_id}
    orgs = {
        o.id: o for o in (await db.execute(
            select(PartnerOrganization).where(PartnerOrganization.id.in_(org_ids))
        )).scalars().all()
    } if org_ids else {}

    out = []
    for p, next_contact in rows:
        d = _partner_summary(p, next_contact, owners.get(p.owner_id or ""))
        org = orgs.get(p.organization_id or "")
        d.update({
            "funder_tier": p.funder_tier,
            "linkedin_url": p.linkedin_url,
            "website": p.website,
            "org_name": org.name if org else (p.organization or None),
            "org_website": org.website if org else None,
        })
        out.append(d)
    await _attach_engagement(out, db)

    ids = [d["id"] for d in out]
    task_rows = (await db.execute(
        select(PartnerTask.partner_id, func.count(PartnerTask.id), func.min(PartnerTask.due_date))
        .where(PartnerTask.partner_id.in_(ids), PartnerTask.status.in_(OPEN))
        .group_by(PartnerTask.partner_id)
    )).all() if ids else []
    tasks = {pid: (n, due) for pid, n, due in task_rows}
    for d in out:
        n, due = tasks.get(d["id"], (0, None))
        d["open_tasks"] = n
        d["next_task_due"] = due.isoformat() if due else None

    return {"tiers": list(FUNDER_TIERS), "funders": out}


@router.get("/follow-ups")
async def funder_follow_ups(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Open tasks on funders, soonest due first."""
    await _funders_org(db, current_user)
    from app.routers.partner_tasks import task_dicts

    tasks = (await db.execute(
        select(PartnerTask)
        .join(Partner, Partner.id == PartnerTask.partner_id)
        .where(partner_org_filter(current_user), Partner.funder_tier.isnot(None), PartnerTask.status.in_(OPEN))
        .order_by(PartnerTask.due_date.asc().nullslast(), PartnerTask.created_at.desc())
        .limit(100)
    )).scalars().all()
    return await task_dicts(tasks, db)


@router.post("/", status_code=201)
async def create_funder(data: FunderCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Add a new person straight onto the Funders tab (they're a partner too)."""
    await _funders_org(db, current_user)
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Name is required.")
    org_name = (data.organization or "").strip() or None
    org_id = None
    if org_name:
        org_id = (await db.execute(
            select(PartnerOrganization.id).where(
                PartnerOrganization.institution_id == current_user.institution_id,
                func.lower(PartnerOrganization.name) == org_name.lower(),
            ).limit(1)
        )).scalar()
    p = Partner(
        id=str(uuid.uuid4()), institution_id=current_user.institution_id, created_by=current_user.id,
        name=name, organization=org_name, organization_id=org_id, title=data.title, email=data.email,
        linkedin_url=data.linkedin_url, city=data.city, country=data.country, notes=data.notes,
        funder_tier=data.tier, tags=[], project_types=[], status="prospect", relationship_stage="prospect",
        enrichment_status="pending" if data.research else "none",
    )
    db.add(p)
    await db.commit()
    if data.research:
        from app.services.partner_research import start_research
        start_research([(p.id, False)])
    return {"id": p.id}


@router.put("/{partner_id}/tier")
async def set_tier(partner_id: str, data: TierIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Put a partner on the Funders tab at a tier, move them, or (tier=null) take them off."""
    await _funders_org(db, current_user)
    p = await _org_partner(db, current_user, partner_id)
    p.funder_tier = data.tier
    await db.commit()
    return {"id": p.id, "funder_tier": p.funder_tier}


@router.post("/bulk-tier")
async def bulk_tier(data: BulkTierIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _funders_org(db, current_user)
    if not data.ids:
        return {"updated": 0}
    partners = (await db.execute(
        select(Partner).where(Partner.id.in_(data.ids[:500]), partner_org_filter(current_user))
    )).scalars().all()
    for p in partners:
        p.funder_tier = data.tier
    await db.commit()
    return {"updated": len(partners)}


# ── Switching the tab on per organization (super-admin) ───────────────────────

@router.get("/feature/{institution_id}")
async def get_feature(institution_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_super_admin())):
    inst = await db.get(Institution, institution_id)
    if not inst:
        raise HTTPException(404, "Organization not found")
    return {"enabled": has_feature(inst)}


@router.put("/feature/{institution_id}")
async def set_feature(
    institution_id: str, data: FeatureIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_super_admin()),
):
    inst = await db.get(Institution, institution_id)
    if not inst:
        raise HTTPException(404, "Organization not found")
    inst.features = {**(inst.features or {}), FEATURE: data.enabled}
    await db.commit()
    return {"enabled": has_feature(inst)}
