"""Grant writing docs — extra documents written in the grant editor.

The main proposal stays in `active_grants.editor_document`; these are the other
pieces (cover letter, abstract, notes…) a grant needs, each its own editor tab.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import grant_access
from app.database import get_db
from app.models.comment import Comment
from app.models.grant_writing_doc import GrantWritingDoc
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.doc_import import IMPORTABLE_EXTENSIONS, file_to_html

router = APIRouter(dependencies=[Depends(grant_access())])
_editor = [Depends(grant_access(require_editor=True))]
MAX_IMPORT_BYTES = 20 * 1024 * 1024


class WritingDocOut(BaseModel):
    id: str
    grant_id: str
    title: str
    content_html: str
    position: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WritingDocCreate(BaseModel):
    title: str = Field("Untitled document", min_length=1, max_length=300)
    content_html: str = ""


class WritingDocUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    content_html: Optional[str] = None


async def _get_doc(grant_id: str, doc_id: str, db: AsyncSession) -> GrantWritingDoc:
    doc = await db.get(GrantWritingDoc, doc_id)
    if not doc or doc.grant_id != grant_id:
        raise HTTPException(404, "Document not found")
    return doc


@router.get("/{grant_id}/writing-docs", response_model=list[WritingDocOut])
async def list_writing_docs(grant_id: str, db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(GrantWritingDoc)
        .where(GrantWritingDoc.grant_id == grant_id)
        .order_by(GrantWritingDoc.position, GrantWritingDoc.created_at)
    )
    return list(rows)


async def _add_doc(grant_id: str, title: str, content_html: str, user: User, db: AsyncSession) -> GrantWritingDoc:
    last = await db.scalar(
        select(func.max(GrantWritingDoc.position)).where(GrantWritingDoc.grant_id == grant_id)
    )
    doc = GrantWritingDoc(
        grant_id=grant_id,
        title=title.strip()[:300] or "Untitled document",
        content_html=content_html,
        position=(last or 0) + 1,
        created_by=user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.post("/{grant_id}/writing-docs", response_model=WritingDocOut, status_code=201, dependencies=_editor)
async def create_writing_doc(
    grant_id: str,
    body: WritingDocCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _add_doc(grant_id, body.title, body.content_html, current_user, db)


@router.post("/{grant_id}/writing-docs/import", response_model=WritingDocOut, status_code=201, dependencies=_editor)
async def import_writing_doc(
    grant_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a writing doc from an uploaded .docx, .html, .md or .txt file."""
    name = file.filename or "Imported document"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in IMPORTABLE_EXTENSIONS:
        raise HTTPException(400, "Import a .docx, .html, .md or .txt file")
    data = await file.read()
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "File is too large (max 20 MB)")
    try:
        html = file_to_html(name, data)
    except Exception:  # noqa: BLE001 — malformed upload
        raise HTTPException(400, "Could not read that file")
    title = name.rsplit(".", 1)[0] if "." in name else name
    return await _add_doc(grant_id, title, html, current_user, db)


@router.patch("/{grant_id}/writing-docs/{doc_id}", response_model=WritingDocOut, dependencies=_editor)
async def update_writing_doc(
    grant_id: str, doc_id: str, body: WritingDocUpdate, db: AsyncSession = Depends(get_db),
):
    doc = await _get_doc(grant_id, doc_id, db)
    if body.title is not None:
        doc.title = body.title.strip()
    if body.content_html is not None:
        doc.content_html = body.content_html
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/{grant_id}/writing-docs/{doc_id}", status_code=204, dependencies=_editor)
async def delete_writing_doc(grant_id: str, doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await _get_doc(grant_id, doc_id, db)
    await db.execute(
        delete(Comment).where(
            Comment.entity_type == "grant", Comment.entity_id == grant_id, Comment.document_id == doc_id,
        )
    )
    await db.delete(doc)
    await db.commit()
