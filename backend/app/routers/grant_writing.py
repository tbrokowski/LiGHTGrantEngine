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
from app.services.document_parser import parse_uploaded_bytes
from app.services import storage as storage_svc
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

    try:
        analysis = await orchestrator.analyze_call_document(grant, parsed_text, db, grant.call_url or "")
    except ValueError as e:
        raise HTTPException(502, str(e)) from e
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


async def _resolve_call_text(grant_id: str, grant, db: AsyncSession) -> tuple[str, Document | None]:
    """Load call document text for analysis, re-parsing from R2 if parsed_text is missing."""
    result = await db.execute(
        select(Document).where(
            Document.grant_id == grant_id,
            Document.document_type == DocumentType.CALL_DOCUMENT,
        ).order_by(Document.uploaded_at.desc())
    )
    doc = result.scalars().first()
    call_text = (doc.parsed_text if doc else None) or ""
    if doc and len(call_text.strip()) < 200:
        r2_key = storage_svc.resolve_storage_key(doc.notes)
        if r2_key and storage_svc.object_exists(r2_key):
            try:
                raw = storage_svc.download_file(r2_key)
                call_text = parse_uploaded_bytes(raw, doc.file_name or "call.pdf")
                doc.parsed_text = call_text
                doc.processing_status = ProcessingStatus.PROCESSED
                await db.commit()
            except Exception:
                pass
    if not call_text.strip():
        call_text = grant.call_requirements or ""
    return call_text, doc


@router.post("/{grant_id}/writing/analyze-call")
async def reanalyze_call(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    call_text, _doc = await _resolve_call_text(grant_id, grant, db)
    if not call_text.strip():
        raise HTTPException(400, "No call document or requirements available")
    try:
        analysis = await orchestrator.analyze_call_document(grant, call_text, db, grant.call_url or "")
    except ValueError as e:
        raise HTTPException(502, str(e)) from e
    await db.refresh(grant)
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


class GenerateDraftRequest(BaseModel):
    flagged_sections: Optional[list[str]] = None


@router.post("/{grant_id}/writing/generate-draft")
async def generate_draft(
    grant_id: str,
    data: Optional[GenerateDraftRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    skeleton = grant.proposal_skeleton or {}
    has_sections = bool(skeleton.get("sections"))
    has_raw_text = bool(skeleton.get("raw_text"))
    if not has_sections and not has_raw_text:
        raise HTTPException(400, "Proposal skeleton is required. Generate or edit skeleton first.")

    flagged_sections = (data.flagged_sections if data else None) or skeleton.get("flagged_sections") or None

    async def stream():
        async for chunk in orchestrator.generate_draft_stream(
            grant, db, flagged_sections=flagged_sections
        ):
            yield chunk
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class RefineDraftAnswer(BaseModel):
    question_id: str
    section_name: str
    answer: str


class RefineDraftRequest(BaseModel):
    answers: list[RefineDraftAnswer]


@router.post("/{grant_id}/writing/refine-draft")
async def refine_draft(
    grant_id: str,
    data: RefineDraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Re-draft each section that the meta-agent asked a question about,
    incorporating the user's answer as additional instructions.
    Returns the updated document_html.
    """
    from app.ai.agents.section_drafter import draft_section
    from app.ai.agents.intro_architect import draft_introduction
    from app.ai.context.grant_context import insert_section_content, parse_document_sections

    grant = await _get_grant(grant_id, db)
    if not grant.editor_document:
        raise HTTPException(400, "No draft document to refine")

    answered = [a for a in data.answers if a.answer.strip()]
    if not answered:
        return {"document_html": grant.editor_document, "refined": 0}

    call_req = grant.call_requirements or ""
    html = grant.editor_document

    INTRO_KEYWORDS = ("intro", "background", "problem", "executive", "rationale")

    for ans in answered:
        section_name = ans.section_name
        user_instruction = ans.answer.strip()

        # Pull existing section HTML as skeleton content
        doc_sections = parse_document_sections(html)
        existing_content = ""
        for s in doc_sections:
            if s.heading.lower() == section_name.lower():
                existing_content = s.plain_text
                break

        is_intro = any(kw in section_name.lower() for kw in INTRO_KEYWORDS)
        try:
            if is_intro:
                result = await draft_introduction(
                    grant_idea=grant.grant_idea or "",
                    call_requirements=call_req,
                    funder=grant.funder or "",
                    style_profile=grant.style_profile or {},
                    skeleton_content=existing_content,
                    compliance_guidance=call_req[:500],
                    evidence_summary="",
                    narrative_context={},
                    user_instructions=user_instruction,
                )
            else:
                result = await draft_section(
                    section_name=section_name,
                    grant_idea=grant.grant_idea or "",
                    call_requirements=call_req,
                    funder=grant.funder or "",
                    style_profile=grant.style_profile or {},
                    skeleton_content=existing_content,
                    compliance_guidance=call_req[:500],
                    evidence_summary="",
                    narrative_context={},
                    user_instructions=user_instruction,
                )
            draft_text = result.get("draft", "")
            if draft_text and not draft_text.strip().startswith("<"):
                draft_html = "".join(f"<p>{p.strip()}</p>" for p in draft_text.split("\n\n") if p.strip())
            else:
                draft_html = draft_text
            html = insert_section_content(html, section_name, draft_html)
        except Exception:
            continue

    grant.editor_document = html
    # Clear the answered questions from stored skeleton state
    skeleton = dict(grant.proposal_skeleton or {})
    pending_qs: list[dict] = skeleton.get("_meta_agent_questions", [])
    answered_ids = {a.question_id for a in answered}
    remaining = [q for q in pending_qs if q.get("question_id") not in answered_ids]
    if remaining:
        skeleton["_meta_agent_questions"] = remaining
    else:
        skeleton.pop("_meta_agent_questions", None)
    grant.proposal_skeleton = skeleton
    await db.commit()

    return {"document_html": html, "refined": len(answered)}


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
        user=current_user,
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
