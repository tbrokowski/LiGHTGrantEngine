"""Grant writing studio endpoints — Idea → Skeleton → Draft → Review workflow."""
from __future__ import annotations

import json
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.context.grant_context import GrantContextManager
from app.ai.orchestrator.grant_writing import GrantWritingOrchestrator
from app.workers.celery_app import celery_app
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


class SectionConstraint(BaseModel):
    name: str
    word_limit: Optional[int] = None
    page_limit: Optional[str] = None
    priority: Optional[str] = "medium"
    order: Optional[int] = None


class GenerateSkeletonRequest(BaseModel):
    section_constraints: Optional[list[SectionConstraint]] = None
    total_word_limit: Optional[int] = None
    total_page_limit: Optional[str] = None


class SkeletonConstraintsUpdate(BaseModel):
    total_word_limit: Optional[int] = None
    total_page_limit: Optional[str] = None
    sections: Optional[list[SectionConstraint]] = None
    document_constraints: Optional[dict] = None


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
        "call_intelligence": grant.call_intelligence or {},
        "document_constraints": getattr(grant, "document_constraints", None) or {},
        "call_requirements": grant.call_requirements,
        "proposal_skeleton": skeleton,
        "style_profile": grant.style_profile or {},
        "last_review": grant.last_review or {},
        "skeleton_section_count": len(sections),
        "has_call_analysis": bool(grant.call_analysis),
        "call_analysis_status": getattr(grant, "call_analysis_status", None) or "idle",
        "call_analysis_error": getattr(grant, "call_analysis_error", None),
        "call_analysis_steps": getattr(grant, "call_analysis_steps", None) or [],
        "has_draft": bool(grant.editor_document),
        "overview_figure_url": getattr(grant, "overview_figure_url", None),
        "overview_figure_alt": getattr(grant, "overview_figure_alt", None),
        # Skeleton async job state
        "skeleton_status": getattr(grant, "skeleton_status", None) or "idle",
        "skeleton_steps":  getattr(grant, "skeleton_steps",  None) or [],
        "skeleton_error":  getattr(grant, "skeleton_error",  None),
        # Draft async job state
        "draft_status":    getattr(grant, "draft_status",    None) or "idle",
        "draft_steps":     getattr(grant, "draft_steps",     None) or [],
        "draft_error":     getattr(grant, "draft_error",     None),
        # Full document for frontend after draft completes
        "editor_document": grant.editor_document,
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

    await db.refresh(grant)
    analysis_payload = await _enqueue_call_analysis(
        grant, parsed_text, db, current_user.id
    )
    return JSONResponse(
        status_code=202,
        content={
            "document_id": doc_id,
            "file_name": safe_name,
            "file_url": file_url,
            "parsed_chars": len(parsed_text),
            **analysis_payload,
        },
    )


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


async def _enqueue_call_analysis(
    grant: ActiveGrant,
    call_text: str,
    db: AsyncSession,
    user_id: str,
    force: bool = False,
) -> dict:
    """Mark analysis as running, commit, and queue Celery worker.

    force=True clears any stuck running/failed state before re-queuing.
    """
    from app.workers.celery_app import celery_app

    current_status = grant.call_analysis_status or "idle"
    if current_status == "running" and not force:
        return {
            "status": "running",
            "call_analysis_status": "running",
            "message": "Call analysis already in progress",
        }

    existing_analysis = bool(grant.call_analysis)
    grant.call_analysis_status = "running"
    grant.call_analysis_error = None
    grant.call_analysis_steps = [
        {"id": "parse",   "label": "Loading document text",              "status": "active"},
        {"id": "extract", "label": "Extracting requirements and context", "status": "pending"},
        {"id": "save",    "label": "Saving Call Intelligence",            "status": "pending"},
    ]
    await db.commit()

    celery_app.send_task(
        "app.workers.grant_writing_tasks.analyze_grant_call",
        args=[
            grant.id,
            call_text,
            grant.call_url or "",
            grant.funder or "",
            user_id,
            existing_analysis,
        ],
        queue="call_analysis",
    )
    return {
        "status": "running",
        "call_analysis_status": "running",
        "message": "Call analysis started",
    }


@router.post("/{grant_id}/writing/analyze-call", status_code=202)
async def reanalyze_call(
    grant_id: str,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    grant = await _get_grant(grant_id, db)
    call_text, _doc = await _resolve_call_text(grant_id, grant, db)
    if not call_text.strip():
        raise HTTPException(400, "No call document or requirements available")
    payload = await _enqueue_call_analysis(grant, call_text, db, current_user.id, force=force)
    return JSONResponse(status_code=202, content=payload)


@router.post("/{grant_id}/writing/reset-analysis")
async def reset_call_analysis(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hard-reset a stuck call analysis back to idle so the user can re-trigger it."""
    grant = await _get_grant(grant_id, db)
    grant.call_analysis_status = "idle"
    grant.call_analysis_error = None
    grant.call_analysis_steps = []
    await db.commit()
    return {"ok": True, "status": "idle"}


@router.post("/{grant_id}/writing/generate-skeleton", status_code=202)
async def generate_skeleton(
    grant_id: str,
    body: GenerateSkeletonRequest = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enqueue skeleton generation as a background Celery task."""
    body = body or GenerateSkeletonRequest()
    grant = await _get_grant(grant_id, db)
    if not grant.grant_idea:
        raise HTTPException(400, "Grant idea is required before generating skeleton")
    if getattr(grant, "skeleton_status", "idle") == "running":
        return JSONResponse(status_code=202, content={"status": "running", "message": "Skeleton generation already in progress"})

    grant.skeleton_status = "running"
    grant.skeleton_steps = []
    grant.skeleton_error = None
    await db.commit()

    section_constraints = (
        [sc.model_dump() for sc in body.section_constraints]
        if body.section_constraints else None
    )
    celery_app.send_task(
        "app.workers.grant_writing_tasks.generate_skeleton_task",
        args=[grant_id, current_user.id],
        kwargs={
            "user_section_constraints": section_constraints,
            "user_total_word_limit": body.total_word_limit,
            "user_total_page_limit": body.total_page_limit,
        },
        queue="call_analysis",
    )
    return JSONResponse(status_code=202, content={"status": "running", "message": "Skeleton generation started"})


@router.post("/{grant_id}/writing/reset-skeleton")
async def reset_skeleton(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hard-reset a stuck skeleton generation back to idle."""
    grant = await _get_grant(grant_id, db)
    grant.skeleton_status = "idle"
    grant.skeleton_steps = []
    grant.skeleton_error = None
    await db.commit()
    return {"ok": True, "status": "idle"}


@router.patch("/{grant_id}/writing/skeleton-constraints")
async def update_skeleton_constraints(
    grant_id: str,
    data: SkeletonConstraintsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merge updated word/page limits and section constraints into proposal_skeleton and document_constraints."""
    grant = await _get_grant(grant_id, db)
    skeleton = dict(grant.proposal_skeleton or {})
    doc_constraints = dict(getattr(grant, "document_constraints", None) or {})

    if data.total_word_limit is not None:
        skeleton["total_word_limit"] = data.total_word_limit
        doc_constraints["total_word_limit"] = data.total_word_limit
    if data.total_page_limit is not None:
        skeleton["total_page_limit"] = data.total_page_limit
        doc_constraints["total_page_limit"] = data.total_page_limit
    if data.sections is not None:
        sections_payload = [s.model_dump() for s in data.sections]
        skeleton["sections"] = sections_payload
        doc_constraints["sections"] = sections_payload
    if data.document_constraints is not None:
        doc_constraints = {**doc_constraints, **data.document_constraints}
        if data.document_constraints.get("sections"):
            skeleton["sections"] = data.document_constraints["sections"]
        if data.document_constraints.get("total_word_limit") is not None:
            skeleton["total_word_limit"] = data.document_constraints["total_word_limit"]
        if data.document_constraints.get("total_page_limit") is not None:
            skeleton["total_page_limit"] = data.document_constraints["total_page_limit"]

    grant.proposal_skeleton = skeleton
    grant.document_constraints = doc_constraints
    await db.commit()
    return {"proposal_skeleton": skeleton, "document_constraints": doc_constraints}


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




@router.post("/{grant_id}/writing/preview-draft-plan")
async def preview_draft_plan(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dry-run draft orchestrator — returns execution plan without starting draft."""
    grant = await _get_grant(grant_id, db)
    skeleton = grant.proposal_skeleton or {}
    if not skeleton.get("sections") and not skeleton.get("raw_text"):
        raise HTTPException(400, "Proposal skeleton required")
    if not grant.call_analysis:
        raise HTTPException(400, "Call analysis required")
    from app.ai.agents.draft_orchestrator import build_draft_execution_plan
    from app.ai.orchestrator.adaptive_draft import wait_for_call_intelligence

    ci = await wait_for_call_intelligence(grant, db, timeout_sec=45)
    plan = await build_draft_execution_plan(
        opportunity_title=grant.title or "",
        funder=grant.funder or "",
        grant_idea=grant.grant_idea or "",
        call_requirements=grant.call_requirements or "",
        call_analysis=grant.call_analysis or {},
        call_intelligence=ci,
        proposal_skeleton=skeleton,
        call_strategy=grant.call_strategy,
        aligned_concept=grant.aligned_concept,
    )
    grant.draft_execution_plan = plan
    await db.commit()
    return {"draft_execution_plan": plan}


@router.post("/{grant_id}/writing/generate-draft", status_code=202)
async def generate_draft(
    grant_id: str,
    data: Optional[GenerateDraftRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enqueue draft generation as a background Celery task."""
    grant = await _get_grant(grant_id, db)
    skeleton = grant.proposal_skeleton or {}
    has_sections = bool(skeleton.get("sections"))
    has_raw_text = bool(skeleton.get("raw_text"))
    if not has_sections and not has_raw_text:
        raise HTTPException(400, "Proposal skeleton is required. Generate or edit skeleton first.")
    if getattr(grant, "draft_status", "idle") == "running":
        return JSONResponse(status_code=202, content={"status": "running", "message": "Draft generation already in progress"})

    flagged_sections = (data.flagged_sections if data else None) or skeleton.get("flagged_sections") or None

    grant.draft_status = "running"
    grant.draft_steps = []
    grant.draft_error = None
    await db.commit()

    celery_app.send_task(
        "app.workers.grant_writing_tasks.generate_draft_task",
        args=[grant_id, current_user.id, flagged_sections],
        queue="call_analysis",
    )
    return JSONResponse(status_code=202, content={"status": "running", "message": "Draft generation started"})


@router.post("/{grant_id}/writing/reset-draft")
async def reset_draft(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hard-reset a stuck draft generation back to idle."""
    grant = await _get_grant(grant_id, db)
    grant.draft_status = "idle"
    grant.draft_steps = []
    grant.draft_error = None
    await db.commit()
    return {"ok": True, "status": "idle"}


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


# Tool-calling citation intents — if the user message matches these and selected_text
# is present, we inject "find citation for this text" into the intent.
_CITATION_INTENT_PATTERNS = [
    "find citation", "cite this", "find reference", "add citation",
    "source for this", "reference for this", "back this up",
]

_TOOL_AGENT_SYSTEM_ADDENDUM = """
You have access to tools that allow you to retrieve accurate, up-to-date information:
- search_archive: search past funded grant proposals in the archive
- lookup_opportunity: look up a specific grant opportunity or programme by name
- search_citations: search academic literature (OpenAlex + PubMed) for a topic
- find_citation_for_text: find citations supporting a specific highlighted text passage
- search_org_docs: search uploaded workspace files and documents

Use these tools proactively when answering questions. When you cite sources retrieved
from tools, include inline reference markers like [1], [2] in your text. The user will
see the sources in a panel below your response. Always prefer precise, grounded answers
with citations over generic advice.
"""


@router.post("/{grant_id}/writing/chat-stream")
async def writing_chat_stream(
    grant_id: str,
    req: WritingChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agentic streaming chat with tool calling, RAG, opportunity lookup, and inline citations."""
    from app.ai.agents.chat_agent import run_agent_loop
    from app.ai.tools.chat_tools import CHAT_TOOLS, execute_tool
    from datetime import datetime

    grant = await _get_grant(grant_id, db)
    conv = await _get_or_create_conversation(grant_id, db)
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")

    # Detect citation intent on highlighted text — auto-redirect to find_citation_for_text
    effective_messages = list(req.messages)
    if req.selected_text and any(
        pattern in last_user.lower() for pattern in _CITATION_INTENT_PATTERNS
    ):
        effective_messages = [
            m for m in req.messages if m.role != "user" or m.content != last_user
        ]
        effective_messages.append(
            WritingChatMessage(
                role="user",
                content=(
                    f"Find academic citations to support this text:\n\n"
                    f'"{req.selected_text[:600]}"'
                ),
            )
        )
        last_user = effective_messages[-1].content

    ctx = await context_mgr.build(
        grant,
        db,
        active_section_title=req.active_section,
        document_html=req.document_context,
        user_query=last_user,
        conversation=conv,
        user=current_user,
    )
    system_message = context_mgr.to_system_prompt(ctx) + _TOOL_AGENT_SYSTEM_ADDENDUM
    if req.selected_text:
        system_message += f"\n\n--- SELECTED TEXT (user has this highlighted) ---\n{req.selected_text[:1200]}"

    llm_messages = [{"role": "system", "content": system_message}]
    for m in effective_messages:
        llm_messages.append({"role": m.role, "content": m.content})

    # Persist request messages to conversation history
    stored = list(conv.messages or [])
    for m in effective_messages[-2:]:
        stored.append({"role": m.role, "content": m.content})
    conv.messages = stored[-20:]
    conv.updated_at = datetime.utcnow()
    await db.commit()

    # Resolve institution_id for opportunity lookup
    institution_id = getattr(current_user, "institution_id", None)

    async def tool_executor(name: str, args: dict):
        return await execute_tool(
            name=name,
            args=args,
            db=db,
            grant_id=grant_id,
            institution_id=institution_id,
        )

    context_chips = context_mgr.context_chip_labels(ctx)

    async def generate():
        full_response_parts: list[str] = []
        try:
            async for event in run_agent_loop(
                messages=llm_messages,
                tools=CHAT_TOOLS,
                tool_executor=tool_executor,
                context_chips=context_chips,
            ):
                if event.get("type") == "content":
                    full_response_parts.append(event["content"])
                yield f"data: {json.dumps(event)}\n\n"

            # Persist assistant response to conversation history
            if full_response_parts:
                full_text = "".join(full_response_parts)
                conv.messages = (conv.messages or []) + [
                    {"role": "assistant", "content": full_text}
                ]
                await db.commit()

            # Trigger background summarization when conversation is long
            _maybe_trigger_summarization(grant_id, conv)

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)[:300]})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _maybe_trigger_summarization(grant_id: str, conv) -> None:
    """Fire-and-forget conversation summarization when history is long."""
    try:
        msg_count = len(conv.messages or [])
        if msg_count >= 18:
            from app.workers.celery_app import celery_app as _celery
            _celery.send_task(
                "app.workers.grant_writing_tasks.summarize_conversation_task",
                args=[grant_id],
                queue="call_analysis",
            )
    except Exception:
        pass  # Summarization is non-critical


class FigureGenerationRequest(BaseModel):
    custom_instructions: Optional[str] = None


@router.post("/{grant_id}/writing/generate-figure")
async def generate_overview_figure(
    grant_id: str,
    req: FigureGenerationRequest = FigureGenerationRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate an AI overview figure for the grant proposal and store it.
    The image is downloaded from OpenAI's temporary URL and uploaded to R2.
    Returns { figure_url, alt_text } where figure_url is a presigned R2 URL.
    """
    import httpx
    from app.ai.agents.figure_generator import generate_overview_figure as _generate

    grant = await _get_grant(grant_id, db)

    try:
        result = await _generate(
            opportunity_title=grant.title or "",
            grant_idea=grant.grant_idea or "",
            call_strategy=grant.call_strategy,
            call_analysis=grant.call_analysis or {},
            aligned_concept=grant.aligned_concept,
            funder=grant.funder or "",
            custom_instructions=req.custom_instructions or "",
        )
    except Exception as exc:
        raise HTTPException(500, f"Figure generation failed: {str(exc)[:200]}") from exc

    # Download the image from OpenAI's temporary URL and store in R2
    temp_url = result.get("image_url", "")
    r2_key = storage_svc.build_key("overview_figure.png", grant_id=grant_id)
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            img_response = await http.get(temp_url)
            img_response.raise_for_status()
            image_bytes = img_response.content

        storage_svc.upload_file(r2_key, image_bytes, content_type="image/png")
        figure_url = storage_svc.get_presigned_url(r2_key, expires_in=86400 * 7, filename="overview_figure.png")
    except Exception as exc:
        # Fall back to OpenAI temporary URL if R2 upload fails
        figure_url = temp_url
        r2_key = None

    alt_text = result.get("alt_text", "Grant proposal overview figure")

    grant.overview_figure_url = figure_url
    grant.overview_figure_alt = alt_text
    await db.commit()

    return {
        "figure_url": figure_url,
        "alt_text": alt_text,
        "revised_prompt": result.get("revised_prompt", ""),
    }


@router.post("/{grant_id}/writing/export-proposal-doc")
async def export_proposal_doc(
    grant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Push draft to linked Google Doc with figures when available."""
    grant = await _get_grant(grant_id, db)
    if not grant.google_doc_id:
        raise HTTPException(400, "Link a Google Doc first")
    if not grant.editor_document:
        raise HTTPException(400, "No draft document to export")
    from app.services.google_auth import get_valid_google_token
    from app.services.google_docs import push_to_doc, insert_image_after_heading

    token = await get_valid_google_token(current_user, db)
    push_to_doc(grant.google_doc_id, grant.editor_document, token)
    if grant.overview_figure_url:
        try:
            insert_image_after_heading(
                grant.google_doc_id,
                grant.overview_figure_url,
                token,
                heading_text="Introduction",
            )
        except Exception:
            pass
    return {"ok": True, "doc_id": grant.google_doc_id}


