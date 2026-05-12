"""Document upload and parsing endpoints."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.document import Document, ProcessingStatus
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()

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
    return [{c.name: getattr(d, c.name) for c in d.__table__.columns if c.name != "embedding"} for d in docs]

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
        file_url=file_url, file_name=file_name, document_type=document_type,
        opportunity_id=opportunity_id, grant_id=grant_id, archive_id=archive_id,
        ai_retrieval_allowed=ai_retrieval_allowed,
        uploaded_by_id=current_user.id,
        processing_status=ProcessingStatus.NOT_PROCESSED,
    )
    db.add(doc)
    await db.commit()
    return {"id": doc.id, "message": "Document linked. Use /parse to extract text."}

@router.post("/{doc_id}/parse")
async def parse_document(doc_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.workers.embedding_tasks.parse_and_embed_document", args=[doc_id])
    return {"message": "Parsing queued", "document_id": doc_id}
