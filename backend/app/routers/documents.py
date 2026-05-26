"""Document upload and parsing endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.document import Document, ProcessingStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.services import storage

router = APIRouter()

# MIME type map for common upload formats
_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "txt": "text/plain",
}


@router.get("/")
async def list_documents(
    opportunity_id: Optional[str] = None,
    grant_id: Optional[str] = None,
    archive_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
):
    """Return a presigned R2 URL that the client (or Celery worker) can use to
    download the file directly. The redirect expires in 1 hour."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    # doc.notes holds the R2 object key (set during upload)
    r2_key = doc.notes
    if r2_key and storage.object_exists(r2_key):
        presigned = storage.get_presigned_url(r2_key, expires_in=3600)
        return RedirectResponse(url=presigned, status_code=302)

    # Fallback: return parsed text if the binary is no longer in storage
    if doc.parsed_text:
        from fastapi.responses import Response
        return Response(content=doc.parsed_text.encode("utf-8"), media_type="text/plain")

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
    return {"id": doc_id, "message": "Upload complete, parsing queued"}
