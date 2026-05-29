"""Partner documents sub-resource — CV upload, parsing, expertise extraction."""
import uuid
import io
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.partner import Partner
from app.models.partner_document import PartnerDocument
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


def _doc_dict(d: PartnerDocument) -> dict:
    return {
        "id": d.id,
        "partner_id": d.partner_id,
        "document_type": d.document_type,
        "filename": d.filename,
        "file_url": d.file_url,
        "file_size": d.file_size,
        "expertise_extracted": d.expertise_extracted,
        "created_at": str(d.created_at) if d.created_at else None,
        "updated_at": str(d.updated_at) if d.updated_at else None,
    }


@router.get("/{partner_id}/documents")
async def list_documents(
    partner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(
        select(PartnerDocument)
        .where(PartnerDocument.partner_id == partner_id)
        .order_by(desc(PartnerDocument.created_at))
    )
    return [_doc_dict(d) for d in res.scalars().all()]


@router.post("/{partner_id}/documents", status_code=201)
async def upload_document(
    partner_id: str,
    file: UploadFile = File(...),
    document_type: str = Form("cv"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a CV, bio, paper, or letter of support. Parses text and extracts expertise."""
    # Verify partner
    res = await db.execute(select(Partner).where(Partner.id == partner_id))
    if not res.scalar_one_or_none():
        raise HTTPException(404, "Partner not found")

    content = await file.read()
    file_size = len(content)
    parsed_text = ""

    # Parse text from PDF or plain text
    if file.filename and file.filename.lower().endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages]
                parsed_text = "\n".join(pages).strip()
        except Exception:
            parsed_text = ""
    elif file.content_type and "text" in file.content_type:
        parsed_text = content.decode("utf-8", errors="ignore")

    # Store file — for now store parsed text only (no S3 in basic mode)
    doc = PartnerDocument(
        id=str(uuid.uuid4()),
        partner_id=partner_id,
        institution_id=getattr(current_user, "institution_id", "") or "",
        document_type=document_type,
        filename=file.filename,
        file_size=file_size,
        parsed_text=parsed_text[:50000] if parsed_text else None,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return {"id": doc.id, "filename": doc.filename, "document_type": doc.document_type}


@router.post("/{partner_id}/documents/{doc_id}/extract-expertise")
async def extract_expertise(
    partner_id: str,
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run AI expertise extraction on a document and update the partner's expertise embedding."""
    res = await db.execute(
        select(PartnerDocument).where(
            PartnerDocument.id == doc_id,
            PartnerDocument.partner_id == partner_id,
        )
    )
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if not doc.parsed_text:
        raise HTTPException(400, "Document has no parsed text. Upload a readable PDF or text file.")

    from app.ai.agents.partner_enrichment_agent import extract_expertise_from_text
    from app.ai.client import get_embedding

    expertise = await extract_expertise_from_text(doc.parsed_text[:8000])
    doc.expertise_extracted = expertise

    # Embed the combined expertise text for semantic search
    expertise_text = " ".join(e.get("area", "") for e in expertise)
    if expertise_text.strip():
        embedding = await get_embedding(expertise_text)
        if embedding:
            doc.embedding = embedding

            # Also update the partner's expertise_embedding
            partner_res = await db.execute(select(Partner).where(Partner.id == partner_id))
            partner = partner_res.scalar_one_or_none()
            if partner:
                partner.expertise_embedding = embedding

    await db.commit()
    return {"id": doc.id, "expertise_extracted": expertise}


@router.delete("/{partner_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    partner_id: str,
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(
        select(PartnerDocument).where(
            PartnerDocument.id == doc_id,
            PartnerDocument.partner_id == partner_id,
        )
    )
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    await db.delete(doc)
    await db.commit()
