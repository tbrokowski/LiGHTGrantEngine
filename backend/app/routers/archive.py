"""Grant archive endpoints."""
import uuid
from typing import Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.archive import GrantArchive
from app.models.section import ProposalSection
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

class ArchiveCreate(BaseModel):
    title: str
    funder: Optional[str] = None
    program: Optional[str] = None
    call_year: Optional[int] = None
    lead_pi: Optional[str] = None
    themes: list[str] = []
    geographies: list[str] = []
    submitted: bool = False
    outcome: Optional[str] = None
    requested_amount: Optional[float] = None
    awarded_amount: Optional[float] = None
    currency: Optional[str] = None
    repository_folder_url: Optional[str] = None
    reviewer_feedback: Optional[str] = None
    lessons_learned: Optional[str] = None

@router.get("/")
async def list_archive(
    funder: Optional[str] = None,
    outcome: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(GrantArchive)
    if funder:
        q = q.where(GrantArchive.funder.ilike(f"%{funder}%"))
    if outcome:
        q = q.where(GrantArchive.outcome == outcome)
    if search:
        q = q.where(or_(GrantArchive.title.ilike(f"%{search}%"), GrantArchive.funder.ilike(f"%{search}%")))
    result = await db.execute(q)
    archives = result.scalars().all()
    return [{c.name: getattr(a, c.name) for c in a.__table__.columns} for a in archives]

@router.post("/", status_code=201)
async def create_archive_entry(data: ArchiveCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    archive = GrantArchive(id=str(uuid.uuid4()), **data.model_dump())
    db.add(archive)
    await db.commit()
    return {"id": archive.id}

@router.get("/{archive_id}")
async def get_archive(archive_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")
    sections_q = select(ProposalSection).where(ProposalSection.archive_id == archive_id)
    sections = (await db.execute(sections_q)).scalars().all()
    data = {c.name: getattr(archive, c.name) for c in archive.__table__.columns}
    data["sections"] = [{c.name: getattr(s, c.name) for c in s.__table__.columns if c.name != "embedding"} for s in sections]
    return data

@router.patch("/{archive_id}")
async def update_archive(archive_id: str, data: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(GrantArchive).where(GrantArchive.id == archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")
    for k, v in data.items():
        if hasattr(archive, k):
            setattr(archive, k, v)
    await db.commit()
    return {"id": archive.id}
