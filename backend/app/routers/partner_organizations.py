"""Partner organizations — company/institution directory."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.partner_organization import PartnerOrganization
from app.models.partner import Partner
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str
    org_type: str = "other"
    website: Optional[str] = None
    domain: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: list[str] = []


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    org_type: Optional[str] = None
    website: Optional[str] = None
    domain: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _org_dict(o: PartnerOrganization) -> dict:
    return {
        "id": o.id,
        "name": o.name,
        "org_type": o.org_type,
        "website": o.website,
        "domain": o.domain,
        "country": o.country,
        "city": o.city,
        "description": o.description,
        "notes": o.notes,
        "tags": o.tags,
        "created_at": str(o.created_at) if o.created_at else None,
        "updated_at": str(o.updated_at) if o.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_orgs(
    q: Optional[str] = None,
    org_type: Optional[str] = None,
    country: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(PartnerOrganization).where(
        PartnerOrganization.institution_id == current_user.institution_id
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(
            PartnerOrganization.name.ilike(like),
            PartnerOrganization.domain.ilike(like),
            PartnerOrganization.country.ilike(like),
        ))
    if org_type:
        stmt = stmt.where(PartnerOrganization.org_type == org_type)
    if country:
        stmt = stmt.where(PartnerOrganization.country.ilike(f"%{country}%"))
    stmt = stmt.order_by(desc(PartnerOrganization.updated_at))
    res = await db.execute(stmt)
    return [_org_dict(o) for o in res.scalars().all()]


@router.post("/", status_code=201)
async def create_org(
    data: OrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = PartnerOrganization(
        id=str(uuid.uuid4()),
        institution_id=current_user.institution_id or "",
        created_by=current_user.id,
        **data.model_dump(),
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return {"id": org.id}


@router.get("/{org_id}")
async def get_org(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(select(PartnerOrganization).where(PartnerOrganization.id == org_id))
    org = res.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")

    # Fetch all contacts at this org
    contacts_res = await db.execute(
        select(Partner).where(Partner.organization_id == org_id).order_by(Partner.name)
    )
    contacts = contacts_res.scalars().all()
    contact_list = [
        {"id": p.id, "name": p.name, "title": p.title, "email": p.email, "status": p.status}
        for p in contacts
    ]
    return {**_org_dict(org), "contacts": contact_list}


@router.patch("/{org_id}")
async def update_org(
    org_id: str,
    data: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(select(PartnerOrganization).where(PartnerOrganization.id == org_id))
    org = res.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(org, k, v)
    await db.commit()
    return {"id": org.id}


@router.delete("/{org_id}", status_code=204)
async def delete_org(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(select(PartnerOrganization).where(PartnerOrganization.id == org_id))
    org = res.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    await db.delete(org)
    await db.commit()
