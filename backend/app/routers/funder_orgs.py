"""Funder Org management endpoints — the actual funding body (e.g. Fulbright),
distinct from Source (a scrapeable portal like UKRI's opportunity listing)."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.funder_org import FunderOrg
from app.models.user import User
from app.routers.auth import get_current_user
from app.auth.permissions import require_org_admin

router = APIRouter()


class FunderOrgCreate(BaseModel):
    name: str
    url: Optional[str] = None
    notes: Optional[str] = None
    deadline_info: Optional[str] = None


class FunderOrgUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None
    deadline_info: Optional[str] = None


def _to_dict(f: FunderOrg) -> dict:
    return {
        "id": f.id,
        "name": f.name,
        "url": f.url,
        "notes": f.notes,
        "deadline_info": f.deadline_info,
        "created_at": str(f.created_at) if f.created_at else None,
        "updated_at": str(f.updated_at) if f.updated_at else None,
    }


@router.get("/")
async def list_funder_orgs(
    q: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(FunderOrg).order_by(FunderOrg.name)
    if q:
        stmt = stmt.where(or_(FunderOrg.name.ilike(f"%{q}%")))
    stmt = stmt.limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(f) for f in rows]


@router.get("/{funder_org_id}")
async def get_funder_org(
    funder_org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = await db.get(FunderOrg, funder_org_id)
    if not f:
        raise HTTPException(404, "Funder org not found")
    return _to_dict(f)


@router.post("/", status_code=201, dependencies=[Depends(require_org_admin())])
async def create_funder_org(
    data: FunderOrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = FunderOrg(id=str(uuid.uuid4()), **data.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _to_dict(f)


@router.patch("/{funder_org_id}", dependencies=[Depends(require_org_admin())])
async def update_funder_org(
    funder_org_id: str,
    data: FunderOrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = await db.get(FunderOrg, funder_org_id)
    if not f:
        raise HTTPException(404, "Funder org not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(f, k, v)
    await db.commit()
    await db.refresh(f)
    return _to_dict(f)


@router.delete("/{funder_org_id}", status_code=204, dependencies=[Depends(require_org_admin())])
async def delete_funder_org(
    funder_org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = await db.get(FunderOrg, funder_org_id)
    if not f:
        raise HTTPException(404, "Funder org not found")
    await db.delete(f)
    await db.commit()
