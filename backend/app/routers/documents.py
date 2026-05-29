"""Document upload and parsing endpoints."""
import json
import uuid
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.document import Document, ProcessingStatus
from app.models.grant_member import GrantMember, GrantMemberStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.services import storage
from app.auth.permissions import is_org_admin, get_redis, get_user_grant_ids
import redis.asyncio as aioredis

router = APIRouter()

# MIME type map for common upload formats
_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "txt": "text/plain",
}


async def _get_document_for_user(
    doc_id: str,
    db: AsyncSession,
    current_user: User,
    redis: aioredis.Redis,
) -> Document:
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.grant_id and not is_org_admin(current_user):
        accessible = await get_user_grant_ids(current_user, db, redis)
        if doc.grant_id not in accessible:
            raise HTTPException(403, "You do not have access to this document.")
    return doc


def _source_url_from_notes(notes: str | None) -> str | None:
    if not notes or not notes.startswith("{"):
        return None
    try:
        return json.loads(notes).get("source_url")
    except (json.JSONDecodeError, TypeError):
        return None


def _inline_filename(doc: Document) -> str:
    return doc.file_name or "document.pdf"


@router.get("/")
async def list_documents(
    opportunity_id: Optional[str] = None,
    grant_id: Optional[str] = None,
    archive_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    # Enforce grant membership when filtering by grant_id
    if grant_id and not is_org_admin(current_user):
        accessible = await get_user_grant_ids(current_user, db, redis)
        if grant_id not in accessible:
            raise HTTPException(403, "You do not have access to this grant's documents.")

    q = select(Document)
    if opportunity_id:
        q = q.where(Document.opportunity_id == opportunity_id)
    if grant_id:
        q = q.where(Document.grant_id == grant_id)
    if archive_id:
        q = q.where(Document.archive_id == archive_id)
    result = await db.execute(q)
    docs = result.scalars().all()
    return [
        {c.name: getattr(d, c.name) for c in d.__table__.columns if c.name != "embedding"}
        for d in docs
    ]


@router.post("/link", status_code=201)
async def link_document(
    file_url: str = Form(...),
    file_name: str = Form(...),
    document_type: str = Form("other"),
    opportunity_id: Optional[str] = Form(None),
    grant_id: Optional[str] = Form(None),
    archive_id: Optional[str] = Form(None),
    ai_retrieval_allowed: bool = Form(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = Document(
        id=str(uuid.uuid4()),
        file_url=file_url,
        file_name=file_name,
        document_type=document_type,
        opportunity_id=opportunity_id,
        grant_id=grant_id,
        archive_id=archive_id,
        ai_retrieval_allowed=ai_retrieval_allowed,
        uploaded_by_id=current_user.id,
        processing_status=ProcessingStatus.NOT_PROCESSED,
    )
    db.add(doc)
    await db.commit()
    return {"id": doc.id, "message": "Document linked. Use /parse to extract text."}


@router.post("/{doc_id}/parse")
async def parse_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.embedding_tasks.parse_and_embed_document", args=[doc_id])
    return {"message": "Parsing queued", "document_id": doc_id}


@router.get("/{doc_id}/content")
async def serve_document_content(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Return a presigned R2 URL. Checks grant/archive membership before serving."""
    doc = await _get_document_for_user(doc_id, db, current_user, redis)

    r2_key = storage.resolve_storage_key(doc.notes)
    if r2_key and storage.object_exists(r2_key):
        ext = (doc.file_format or "").lower()
        if not ext and doc.file_name and "." in doc.file_name:
            ext = doc.file_name.rsplit(".", 1)[-1].lower()
        presigned = storage.get_presigned_url(
            r2_key, expires_in=3600, filename=doc.file_name, content_type_ext=ext or None
        )
        return {"url": presigned, "file_name": doc.file_name}

    # Fallback: return parsed text if the binary is no longer in storage
    if doc.parsed_text:
        return {"text": doc.parsed_text, "file_name": doc.file_name}

    raise HTTPException(404, "Document content not found")


@router.get("/{doc_id}/stream")
async def stream_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Stream document bytes for in-app viewing (iframe via blob URL on the client)."""
    doc = await _get_document_for_user(doc_id, db, current_user, redis)
    filename = _inline_filename(doc)
    ext = (doc.file_format or "").lower()
    if not ext and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
    media_type = _CONTENT_TYPES.get(ext, "application/octet-stream")

    r2_key = storage.resolve_storage_key(doc.notes)
    if r2_key and storage.object_exists(r2_key):
        try:
            data = storage.download_file(r2_key)
        except FileNotFoundError:
            raise HTTPException(404, "Document content not found") from None
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    source_url = _source_url_from_notes(doc.notes)
    if source_url:
        try:
            resp = httpx.get(source_url, timeout=60, follow_redirects=True)
            resp.raise_for_status()
            data = resp.content
        except Exception as exc:
            raise HTTPException(502, f"Could not fetch document from source: {exc}") from exc
        if ext == "pdf" or filename.lower().endswith(".pdf"):
            media_type = "application/pdf"
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    raise HTTPException(404, "Document content not found")


@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form("other"),
    grant_id: Optional[str] = Form(None),
    opportunity_id: Optional[str] = Form(None),
    archive_id: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    doc_id = str(uuid.uuid4())
    filename = file.filename or "document"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")

    # Build R2 key and upload
    r2_key = storage.build_key(
        filename,
        grant_id=grant_id,
        opportunity_id=opportunity_id,
        archive_id=archive_id,
        doc_id=doc_id,
    )
    storage.upload_file(r2_key, content, content_type=content_type)

    from app.config import get_settings
    api_url = get_settings().api_url.rstrip("/")

    doc = Document(
        id=doc_id,
        file_name=filename,
        # Public-facing URL goes through our auth-protected content endpoint
        file_url=f"{api_url}/api/v1/documents/{doc_id}/content",
        file_format=ext,
        document_type=document_type,
        grant_id=grant_id,
        opportunity_id=opportunity_id,
        archive_id=archive_id,
        uploaded_by_id=current_user.id,
        processing_status=ProcessingStatus.NOT_PROCESSED,
        # R2 key stored here so workers can download the file
        notes=r2_key,
    )
    db.add(doc)
    await db.commit()

    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.embedding_tasks.parse_and_embed_document", args=[doc_id])

    # Index into proposal_sections for per-grant RAG (workspace reference docs)
    if grant_id:
        celery_app.send_task(
            "app.workers.archive_tasks.index_workspace_document",
            args=[doc_id, grant_id],
            countdown=45,  # wait for parse_and_embed_document to populate parsed_text
        )

    return {"id": doc_id, "message": "Upload complete, parsing queued"}
