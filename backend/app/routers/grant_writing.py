"""Grant writing studio endpoints — Idea → Skeleton → Draft → Review workflow."""
from __future__ import annotations

import json
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.context.grant_context import GrantContextManager
from app.ai.orchestrator.grant_writing import GrantWritingOrchestrator
from app.database import get_db
from app.models.active_grant import ActiveGrant
from app.models.document import Document, DocumentType, ProcessingStatus
from app.models.workspace_file import WorkspaceFile, FileCategory, FileSourceType
from app.models.grant_writing import GrantCitation, GrantWritingConversation
from app.models.ai_run import AIRun, AgentType, AIRunStatus
from datetime import datetime
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.citation_lookup import search_citations
from app.auth.permissions import grant_access

# Write endpoints require editor access
router = APIRouter(dependencies=[Depends(grant_access(require_editor=True))])
# Read-only writing endpoints (viewers allowed)
status_router = APIRouter(dependencies=[Depends(grant_access())])
orchestrator = GrantWritingOrchestrator()
context_mgr = GrantContextManager()


class IdeaUpdate(BaseModel):
    grant_idea: str
    writing_phase: Optional[str] = None


class SkeletonUpdate(BaseModel):
    proposal_skeleton: dict
    writing_phase: Optional[str] = "skeleton"


class CitationSearchRequest(BaseModel):
    query: str
    section_title: Optional[str] = None
    max_results: int = 5


class WritingChatMessage(BaseModel):
    role: str
    content: str


class WritingChatRequest(BaseModel):
    messages: list[WritingChatMessage]
    document_context: Optional[str] = None
    selected_text: Optional[str] = None
    active_section: Optional[str] = None
    writing_phase: Optional[str] = None


async def _get_grant(grant_id: str, db: AsyncSession) -> ActiveGrant:
    result = await db.execute(select(ActiveGrant).where(ActiveGrant.id == grant_id))
    if grant := result.scalar_one_or_none():
        return grant
    raise HTTPException(404, "Grant not found")


async def _log_ai_run(
    db: AsyncSession,
    user_id: str,
    grant_id: str,
    agent_type: str,
    output: dict,
) -> None:
    from app.config import get_settings
    run = AIRun(
        id=str(uuid.uuid4()),
        user_id=user_id,
        entity_type="grant",
        entity_id=grant_id,
        agent_type=agent_type,
        status=AIRunStatus.COMPLETED,
        output_structured=output,
        model_used=get_settings().ai.model,
        completed_at=datetime.utcnow(),
    )
    db.add(run)
    await db.commit()


async def _get_or_create_conversation(grant_id: str, db: AsyncSession) -> GrantWritingConversation:
    result = await db.execute(
        select(GrantWritingConversation).where(GrantWritingConversation.grant_id == grant_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        conv = GrantWritingConversation(id=str(uuid.uuid4()), grant_id=grant_id, messages=[])
        db.add(conv)
        await db.commit()
        await db.refresh(conv)
    return conv


from app.services.document_parser import parse_uploaded_bytes


@status_router.get("/{grant_id}/writing/status")
async def writing_status(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return full writing state for the grant. Accessible to all collaborators (including viewers)."""
    grant = await _get_grant(grant_id, db)
    skeleton = grant.proposal_skeleton or {}
    sections = skeleton.get("sections") or []
    return {
        "writing_phase": grant.writing_phase or "idea",
        "grant_idea": grant.grant_idea,
        "call_analysis": grant.call_analysis or {},
        "call_requirements": grant.call_requirements,
        "proposal_skeleton": skeleton,
        "style_profile": grant.style_profile or {},
        "last_review": grant.last_review or {},
        "skeleton_section_count": len(sections),
        "has_call_analysis": bool(grant.call_analysis),
        "has_draft": bool(grant.editor_document),
    }


@router.patch("/{grant_id}/writing/idea")
async def save_idea(
    grant_id: str,
    data: IdeaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    grant.grant_idea = data.grant_idea
    if data.writing_phase:
        grant.writing_phase = data.writing_phase
    elif not grant.writing_phase:
        grant.writing_phase = "idea"
    await db.commit()
    return {"writing_phase": grant.writing_phase}


@router.post("/{grant_id}/writing/upload-call")
async def upload_call_document(
    grant_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    safe_name = file.filename or "call_document.pdf"
    doc_id = str(uuid.uuid4())

    # Upload call document to R2
    from app.services import storage as storage_svc
    r2_key = storage_svc.build_key(safe_name, grant_id=grant_id, doc_id=doc_id)
    storage_svc.upload_file(r2_key, content)

    parsed_text = parse_uploaded_bytes(content, safe_name)
    from app.config import get_settings
    api_url = get_settings().api_url.rstrip("/")
    file_url = f"{api_url}/api/v1/documents/{doc_id}/content"

    doc = Document(
        id=doc_id,
        grant_id=grant_id,
        document_type=DocumentType.CALL_DOCUMENT,
        file_name=safe_name,
        file_url=file_url,
        file_format=safe_name.rsplit(".", 1)[-1].lower(),
        parsed_text=parsed_text,
        processing_status=ProcessingStatus.PROCESSED,
        uploaded_by_id=current_user.id,
        ai_retrieval_allowed=True,
        notes=r2_key,
    )
    db.add(doc)

    # Also register in workspace files so it appears in the Files tab
    workspace_file = WorkspaceFile(
        id=str(uuid.uuid4()),
        grant_id=grant_id,
        file_name=safe_name,
        file_type=safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else "pdf",
        file_category=FileCategory.CALL_DOCUMENTS,
        file_url=file_url,
        source_type=FileSourceType.UPLOADED,
        uploaded_by=current_user.id,
        owner_id=current_user.id,
        ai_retrieval_allowed=True,
        description="Call document uploaded for analysis",
    )
    db.add(workspace_file)
    await db.commit()

    analysis = await orchestrator.analyze_call_document(grant, parsed_text, db, grant.call_url or "")
    await _log_ai_run(db, current_user.id, grant_id, AgentType.CALL_ANALYZER, analysis)
    await db.refresh(grant)
    return {
        "document_id": doc_id,
        "file_name": safe_name,
        "file_url": file_url,
        "call_analysis": analysis,
        "call_requirements": grant.call_requirements,
        "parsed_chars": len(parsed_text),
    }


@router.post("/{grant_id}/writing/analyze-call")
async def reanalyze_call(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    result = await db.execute(
        select(Document).where(
            Document.grant_id == grant_id,
            Document.document_type == DocumentType.CALL_DOCUMENT,
        ).order_by(Document.uploaded_at.desc())
    )
    doc = result.scalars().first()
    call_text = (doc.parsed_text if doc else None) or grant.call_requirements or ""
    if not call_text:
        raise HTTPException(400, "No call document or requirements available")
    analysis = await orchestrator.analyze_call_document(grant, call_text, db, grant.call_url or "")
    return {"call_analysis": analysis, "call_requirements": grant.call_requirements}


@router.post("/{grant_id}/writing/generate-skeleton")
async def generate_skeleton(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    if not grant.grant_idea:
        raise HTTPException(400, "Grant idea is required before generating skeleton")
    skeleton = await orchestrator.generate_skeleton(grant, db)
    await _log_ai_run(db, current_user.id, grant_id, AgentType.PROPOSAL_ARCHITECT, skeleton)
    return {"proposal_skeleton": skeleton, "writing_phase": grant.writing_phase}


@router.patch("/{grant_id}/writing/skeleton")
async def update_skeleton(
    grant_id: str,
    data: SkeletonUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    grant.proposal_skeleton = data.proposal_skeleton
    grant.writing_phase = data.writing_phase or "skeleton"
    await db.commit()
    return {"writing_phase": grant.writing_phase}


@router.post("/{grant_id}/writing/generate-draft")
async def generate_draft(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    if not grant.proposal_skeleton or not grant.proposal_skeleton.get("sections"):
        raise HTTPException(400, "Proposal skeleton is required. Generate or edit skeleton first.")

    async def stream():
        async for chunk in orchestrator.generate_draft_stream(grant, db):
            yield chunk
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{grant_id}/writing/review")
async def run_review(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    if not grant.editor_document:
        raise HTTPException(400, "No draft document to review")
    report = await orchestrator.run_review(grant, db)
    await _log_ai_run(db, current_user.id, grant_id, AgentType.GRANT_REVIEWER, report)
    return report


@router.post("/{grant_id}/writing/citations/search")
async def search_citations_endpoint(
    grant_id: str,
    req: CitationSearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant(grant_id, db)
    results = await search_citations(req.query, max_results=req.max_results)
    for r in results:
        citation = GrantCitation(
            id=str(uuid.uuid4()),
            grant_id=grant_id,
            section_title=req.section_title,
            claim_text=req.query,
            source_type=r.get("source_type"),
            external_id=r.get("external_id"),
            formatted_citation=r.get("formatted_citation"),
            url=r.get("url"),
            metadata_=r,
        )
        db.add(citation)
    await db.commit()
    return {"results": results}


@router.get("/{grant_id}/writing/citations")
async def list_citations(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_grant(grant_id, db)
    result = await db.execute(
        select(GrantCitation).where(GrantCitation.grant_id == grant_id).order_by(GrantCitation.created_at.desc())
    )
    citations = result.scalars().all()
    return [{
        "id": c.id,
        "section_title": c.section_title,
        "claim_text": c.claim_text,
        "source_type": c.source_type,
        "formatted_citation": c.formatted_citation,
        "url": c.url,
        "metadata": c.metadata_,
    } for c in citations]


@router.post("/{grant_id}/writing/chat-stream")
async def writing_chat_stream(
    grant_id: str,
    req: WritingChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.ai.client import chat_complete_stream
    from datetime import datetime

    grant = await _get_grant(grant_id, db)
    conv = await _get_or_create_conversation(grant_id, db)
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")

    ctx = await context_mgr.build(
        grant,
        db,
        active_section_title=req.active_section,
        document_html=req.document_context,
        user_query=last_user,
        conversation=conv,
    )
    system_message = context_mgr.to_system_prompt(ctx)
    if req.selected_text:
        system_message += f"\n\n--- SELECTED TEXT ---\n{req.selected_text}"

    messages = [{"role": "system", "content": system_message}]
    for m in req.messages:
        messages.append({"role": m.role, "content": m.content})

    # Persist conversation
    stored = conv.messages or []
    for m in req.messages[-2:]:
        stored.append({"role": m.role, "content": m.content})
    conv.messages = stored[-20:]
    conv.updated_at = datetime.utcnow()
    await db.commit()

    async def generate():
        full_response = []
        try:
            async for chunk in chat_complete_stream(messages, agent_name="grant_writer"):
                full_response.append(chunk)
                yield f"data: {json.dumps({'content': chunk, 'context_chips': context_mgr.context_chip_labels(ctx)})}\n\n"
            conv.messages = (conv.messages or []) + [{"role": "assistant", "content": "".join(full_response)}]
            await db.commit()
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
