"""
AI Assistant endpoints — all Qwen-powered workflows.
Each endpoint calls the appropriate agent and logs the AI run.
"""
import uuid
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.opportunity import Opportunity
from app.models.active_grant import ActiveGrant
from app.models.archive import GrantArchive
from app.models.ai_run import AIRun, AgentType, AIRunStatus
from app.models.user import User
from app.routers.auth import get_current_user
from app.ai.rag.retriever import retrieve_similar_sections, retrieve_reusable_language

router = APIRouter()


# ── Request/Response models ───────────────────────────────────────────────────

class AnalyzeCallRequest(BaseModel):
    opportunity_id: str
    call_text: Optional[str] = None
    extra_instructions: Optional[str] = None


class GoNoGoRequest(BaseModel):
    opportunity_id: str
    team_context: Optional[str] = None


class OutlineRequest(BaseModel):
    grant_id: str
    team_preferences: Optional[str] = None


class DraftSectionRequest(BaseModel):
    grant_id: str
    section_name: str
    section_type: str
    call_requirements: str
    evaluation_criteria: list[str] = []
    word_limit: Optional[int] = None
    user_instructions: Optional[str] = None


class ComplianceCheckRequest(BaseModel):
    grant_id: str
    proposal_draft: str


class FeedbackAnalysisRequest(BaseModel):
    archive_id: str
    reviewer_comments: str
    panel_feedback: Optional[str] = None
    scores: Optional[str] = None


class SimilarGrantsRequest(BaseModel):
    query: str
    section_type: Optional[str] = None
    funder: Optional[str] = None
    outcome_filter: Optional[str] = None
    top_k: int = 8


class MemoryAgentRequest(BaseModel):
    archive_id: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/analyze-call")
async def analyze_call(
    req: AnalyzeCallRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 1: Analyze a grant call document."""
    from app.ai.agents.call_analyzer import analyze_call as _analyze

    opp = await _get_opportunity(req.opportunity_id, db)
    call_text = req.call_text or opp.parsed_text or opp.description or ""
    if not call_text:
        raise HTTPException(400, "No call text available. Attach a document or paste call text.")

    run_id = await _start_ai_run(db, current_user.id, "opportunity", req.opportunity_id, AgentType.CALL_ANALYZER)

    result = await _analyze(
        call_text=call_text,
        call_url=opp.opportunity_url or "",
        funder=opp.funder or "",
        extra_instructions=req.extra_instructions or "",
    )

    # Save AI summary back to opportunity
    if "summary" in result:
        opp.ai_summary = result.get("summary", "")
    await db.commit()

    await _complete_ai_run(db, run_id, result, warnings=result.get("missing_information", []))
    return {**result, "ai_run_id": run_id, "model": _model_name()}


@router.post("/score-opportunity")
async def score_opportunity_endpoint(
    opportunity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Score an opportunity using Qwen fit scorer."""
    from app.ai.agents.fit_scorer import score_opportunity as _score

    opp = await _get_opportunity(opportunity_id, db)
    run_id = await _start_ai_run(db, current_user.id, "opportunity", opportunity_id, AgentType.FIT_SCORER)

    result = await _score(
        title=opp.title,
        description=opp.description or opp.short_summary or "",
        funder=opp.funder or "",
        eligibility=opp.eligibility_criteria or "",
        geography=str(opp.geography),
        award_amount=f"{opp.award_min}-{opp.award_max} {opp.currency}" if opp.award_max else "",
        deadline=str(opp.deadline) if opp.deadline else "",
    )

    # Persist scores
    opp.fit_score = result.get("fit_score", 0)
    opp.priority = result.get("priority", "watchlist")
    opp.fit_rationale = result.get("rationale", "")
    if result.get("matched_themes"):
        opp.thematic_areas = list(set(opp.thematic_areas or []) | set(result["matched_themes"]))
    await db.commit()

    await _complete_ai_run(db, run_id, result)
    return {**result, "ai_run_id": run_id, "model": _model_name()}


@router.post("/go-no-go")
async def go_no_go(
    req: GoNoGoRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 3: Generate a go/no-go decision memo."""
    from app.ai.agents.go_no_go import generate_go_no_go_memo

    opp = await _get_opportunity(req.opportunity_id, db)
    run_id = await _start_ai_run(db, current_user.id, "opportunity", req.opportunity_id, AgentType.GO_NO_GO)

    # Retrieve similar past grants
    similar = await retrieve_similar_sections(
        query=f"{opp.title} {opp.description or ''}",
        db=db,
        top_k=5,
    )

    call_analysis = {"thematic_areas": opp.thematic_areas, "risks": [], "budget_constraints": f"{opp.award_min}-{opp.award_max} {opp.currency or ''}",
                     "deadlines": {"full_proposal": str(opp.deadline)}, "required_sections": [], "required_partners": opp.partner_requirements or ""}

    result = await generate_go_no_go_memo(
        opportunity_title=opp.title,
        call_analysis=call_analysis,
        fit_score=opp.fit_score or 0,
        similar_grants=similar,
        team_context=req.team_context or "",
    )

    await _complete_ai_run(db, run_id, result, sources=similar)
    return {**result, "ai_run_id": run_id, "sources_used": similar[:3], "model": _model_name()}


@router.post("/proposal-outline")
async def proposal_outline(
    req: OutlineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 4: Generate a proposal outline for an active grant."""
    from app.ai.agents.proposal_architect import generate_proposal_outline

    grant = await _get_grant(req.grant_id, db)
    run_id = await _start_ai_run(db, current_user.id, "grant", req.grant_id, AgentType.PROPOSAL_ARCHITECT)

    similar = await retrieve_similar_sections(query=f"{grant.title} {grant.funder or ''}", db=db, top_k=8)

    result = await generate_proposal_outline(
        opportunity_title=grant.title,
        call_analysis={"required_sections": [], "evaluation_criteria": [], "budget_constraints": str(grant.requested_amount)},
        similar_grants=similar,
        team_preferences=req.team_preferences or "",
        internal_deadline=str(grant.internal_deadline) if grant.internal_deadline else "",
        external_deadline=str(grant.external_deadline) if grant.external_deadline else "",
    )

    await _complete_ai_run(db, run_id, result, sources=similar)
    return {**result, "ai_run_id": run_id, "model": _model_name()}


@router.post("/draft-section")
async def draft_section(
    req: DraftSectionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 5: Draft a proposal section with RAG context."""
    from app.ai.agents.section_drafter import draft_section as _draft

    grant = await _get_grant(req.grant_id, db)
    run_id = await _start_ai_run(db, current_user.id, "grant", req.grant_id, AgentType.SECTION_DRAFTER)

    # Retrieve relevant prior sections and reusable language
    retrieved_sections = await retrieve_similar_sections(
        query=f"{req.section_name} {req.call_requirements}",
        db=db,
        section_type=req.section_type,
        top_k=4,
    )
    reusable_lang = await retrieve_reusable_language(
        query=req.call_requirements,
        db=db,
        section_type=req.section_type,
        top_k=3,
    )

    result = await _draft(
        section_name=req.section_name,
        section_type=req.section_type,
        call_requirements=req.call_requirements,
        evaluation_criteria=req.evaluation_criteria,
        retrieved_sections=retrieved_sections,
        reusable_language=reusable_lang,
        word_limit=req.word_limit,
        user_instructions=req.user_instructions or "",
        funder=grant.funder or "",
    )

    await _complete_ai_run(db, run_id, result, sources=retrieved_sections, warnings=result.get("warnings", []))
    return {**result, "ai_run_id": run_id, "retrieved_sections": len(retrieved_sections),
            "reusable_language_used": len(reusable_lang), "model": _model_name()}


@router.post("/compliance-check")
async def compliance_check(
    req: ComplianceCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 6: Check proposal compliance against call requirements."""
    from app.ai.agents.compliance_checker import check_compliance

    grant = await _get_grant(req.grant_id, db)
    run_id = await _start_ai_run(db, current_user.id, "grant", req.grant_id, AgentType.COMPLIANCE_CHECKER)

    result = await check_compliance(
        proposal_draft=req.proposal_draft,
        call_requirements={},
        submission_instructions="",
    )

    await _complete_ai_run(db, run_id, result, warnings=result.get("critical_blockers", []))
    return {**result, "ai_run_id": run_id, "model": _model_name()}


@router.post("/find-similar-grants")
async def find_similar_grants(
    req: SimilarGrantsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 2: Retrieve similar past grants using RAG."""
    results = await retrieve_similar_sections(
        query=req.query,
        db=db,
        section_type=req.section_type,
        funder=req.funder,
        outcome=req.outcome_filter,
        top_k=req.top_k,
    )
    return {"results": results, "count": len(results), "model": _model_name()}


@router.post("/analyze-feedback")
async def analyze_feedback(
    req: FeedbackAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 9: Analyze reviewer feedback."""
    from app.ai.agents.feedback_analyzer import analyze_feedback as _analyze

    result = await db.execute(select(GrantArchive).where(GrantArchive.id == req.archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")

    run_id = await _start_ai_run(db, current_user.id, "archive", req.archive_id, AgentType.FEEDBACK_ANALYZER)

    result_data = await _analyze(
        reviewer_comments=req.reviewer_comments,
        panel_feedback=req.panel_feedback or "",
        outcome=archive.outcome or "",
        scores=req.scores or "",
        funder=archive.funder or "",
    )

    # Save lessons to archive
    if result_data.get("actionable_lessons"):
        import json
        archive.lessons_learned = json.dumps(result_data.get("actionable_lessons"))
    await db.commit()

    await _complete_ai_run(db, run_id, result_data)
    return {**result_data, "ai_run_id": run_id, "model": _model_name()}


@router.post("/process-for-memory")
async def process_for_memory(
    req: MemoryAgentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agent 10: Process a completed grant for institutional memory."""
    from app.ai.agents.memory_agent import process_completed_grant

    result = await db.execute(select(GrantArchive).where(GrantArchive.id == req.archive_id))
    archive = result.scalar_one_or_none()
    if not archive:
        raise HTTPException(404, "Archive entry not found")

    run_id = await _start_ai_run(db, current_user.id, "archive", req.archive_id, AgentType.MEMORY_AGENT)

    result_data = await process_completed_grant(
        grant_title=archive.title,
        funder=archive.funder or "",
        outcome=archive.outcome or "",
        submitted_text="",
        reviewer_feedback=archive.reviewer_feedback or "",
        internal_notes=archive.internal_debrief or "",
    )

    await _complete_ai_run(db, run_id, result_data)
    return {**result_data, "ai_run_id": run_id, "model": _model_name()}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_opportunity(opp_id: str, db: AsyncSession) -> Opportunity:
    result = await db.execute(select(Opportunity).where(Opportunity.id == opp_id))
    opp = result.scalar_one_or_none()
    if not opp:
        raise HTTPException(404, "Opportunity not found")
    return opp


async def _get_grant(grant_id: str, db: AsyncSession) -> ActiveGrant:
    result = await db.execute(select(ActiveGrant).where(ActiveGrant.id == grant_id))
    grant = result.scalar_one_or_none()
    if not grant:
        raise HTTPException(404, "Grant not found")
    return grant


async def _start_ai_run(db: AsyncSession, user_id: str, entity_type: str, entity_id: str, agent_type: str) -> str:
    from app.config import get_settings
    run = AIRun(
        id=str(uuid.uuid4()),
        user_id=user_id,
        entity_type=entity_type,
        entity_id=entity_id,
        agent_type=agent_type,
        status=AIRunStatus.RUNNING,
        model_used=get_settings().ai.model,
    )
    db.add(run)
    await db.commit()
    return run.id


async def _complete_ai_run(
    db: AsyncSession,
    run_id: str,
    output: dict,
    sources: list = None,
    warnings: list = None,
):
    import json
    result = await db.execute(select(AIRun).where(AIRun.id == run_id))
    run = result.scalar_one_or_none()
    if run:
        run.status = AIRunStatus.COMPLETED
        run.output_structured = output
        run.output = json.dumps(output)[:10000]
        run.sources_retrieved = [s.get("id", "") for s in (sources or [])]
        run.warnings = warnings or []
        run.completed_at = datetime.utcnow()
        await db.commit()


def _model_name() -> str:
    from app.config import get_settings
    return get_settings().ai.model
