"""Grant writing docs — extra documents written in the grant editor.

The AI-drafted proposal stays in `active_grants.editor_document`; these are the
other pieces (cover letter, abstract, notes…) a grant needs, each its own editor
tab. An imported .docx keeps its original file and opens in OnlyOffice (see
grant_word_docs.py); other imports become rich text.

A team that writes its own proposal uploads it as the grant's *main* document
(`is_main`): it leads the tabs, and the AI-drafted proposal only appears when
someone starts one.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import grant_access
from app.config import get_settings
from app.database import get_db
from app.models.comment import Comment
from app.models.document import Document, DocumentVersion, ProcessingStatus
from app.models.grant_writing_doc import GrantWritingDoc
from app.models.user import User
from app.routers.auth import get_current_user
from app.routers.grant_word_docs import DOCX_TYPE, validate_docx
from app.services import storage
from app.services.doc_import import IMPORTABLE_EXTENSIONS, file_to_html

router = APIRouter(dependencies=[Depends(grant_access())])
_editor = [Depends(grant_access(require_editor=True))]
MAX_IMPORT_BYTES = 20 * 1024 * 1024


class WritingDocOut(BaseModel):
    id: str
    grant_id: str
    title: str
    content_html: str
    # Set for an imported Word file, which opens in the Word editor.
    document_id: Optional[str] = None
    # The grant's main document, shown first in place of the AI-drafted proposal.
    is_main: bool = False
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
    is_main: Optional[bool] = None


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
        .order_by(GrantWritingDoc.is_main.desc(), GrantWritingDoc.position, GrantWritingDoc.created_at)
    )
    return list(rows)


async def _clear_main(grant_id: str, db: AsyncSession) -> None:
    """Unmark the grant's current main document (one per grant)."""
    await db.execute(
        update(GrantWritingDoc)
        .where(GrantWritingDoc.grant_id == grant_id, GrantWritingDoc.is_main.is_(True))
        .values(is_main=False)
    )
    await db.flush()


async def _add_doc(
    grant_id: str, title: str, content_html: str, user: User, db: AsyncSession,
    document_id: Optional[str] = None,
    main: bool = False,
) -> GrantWritingDoc:
    if main:
        await _clear_main(grant_id, db)
    last = await db.scalar(
        select(func.max(GrantWritingDoc.position)).where(GrantWritingDoc.grant_id == grant_id)
    )
    doc = GrantWritingDoc(
        grant_id=grant_id,
        title=title.strip()[:300] or "Untitled document",
        content_html=content_html,
        document_id=document_id,
        is_main=main,
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
    main: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a writing doc from an uploaded .docx, .html, .md or .txt file.
    `main` makes it the grant's main document (the team's own proposal)."""
    name = file.filename or "Imported document"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in IMPORTABLE_EXTENSIONS:
        raise HTTPException(400, "Import a .docx, .html, .md or .txt file")
    data = await file.read()
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "File is too large (max 20 MB)")
    title = name.rsplit(".", 1)[0] if "." in name else name
    if ext == "docx":
        validate_docx(data)
        word = await _store_word_file(grant_id, name, data, current_user, db)
        return await _add_doc(grant_id, title, "", current_user, db, document_id=word.id, main=main)
    try:
        html = file_to_html(name, data)
    except Exception:  # noqa: BLE001 — malformed upload
        raise HTTPException(400, "Could not read that file")
    return await _add_doc(grant_id, title, html, current_user, db, main=main)


async def _store_word_file(grant_id: str, name: str, data: bytes, user: User, db: AsyncSession) -> Document:
    """Keep the .docx as uploaded, as a grant Document (like a Saved file)."""
    doc_id = str(uuid.uuid4())
    key = storage.build_key(name, grant_id=grant_id, doc_id=doc_id)
    await asyncio.to_thread(storage.upload_file, key, data, DOCX_TYPE)
    doc = Document(
        id=doc_id, file_name=name, file_format="docx", document_type="other",
        file_url=f"{get_settings().api_url.rstrip('/')}/api/v1/documents/{doc_id}/content",
        grant_id=grant_id, uploaded_by_id=user.id, notes=key,
        processing_status=ProcessingStatus.NOT_PROCESSED,
    )
    db.add(doc)
    db.add(DocumentVersion(document_id=doc_id, version=1, storage_key=key, size_bytes=len(data),
                           source="upload", created_by=user.id))
    await db.flush()
    try:
        from app.workers.celery_app import celery_app
        celery_app.send_task("app.workers.embedding_tasks.parse_and_embed_document", args=[doc_id])
    except Exception:  # noqa: BLE001 — parsing only feeds AI context
        pass
    return doc


@router.patch("/{grant_id}/writing-docs/{doc_id}", response_model=WritingDocOut, dependencies=_editor)
async def update_writing_doc(
    grant_id: str, doc_id: str, body: WritingDocUpdate, db: AsyncSession = Depends(get_db),
):
    doc = await _get_doc(grant_id, doc_id, db)
    if body.title is not None:
        doc.title = body.title.strip()
        if doc.document_id:  # the Word file's name follows its tab
            word = await db.get(Document, doc.document_id)
            if word:
                word.file_name = f"{doc.title}.docx"
    if body.content_html is not None and not doc.document_id:
        doc.content_html = body.content_html
    if body.is_main is not None and body.is_main != doc.is_main:
        if body.is_main:
            await _clear_main(grant_id, db)
        doc.is_main = body.is_main
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
    word = await db.get(Document, doc.document_id) if doc.document_id else None
    await db.delete(doc)
    keys: set[str] = set()
    if word:
        keys = set((await db.scalars(
            select(DocumentVersion.storage_key).where(DocumentVersion.document_id == word.id)
        )).all())
        if (current := storage.resolve_storage_key(word.notes)):
            keys.add(current)
        await db.delete(word)
    await db.commit()
    for key in keys:
        await asyncio.to_thread(storage.delete_file, key)
