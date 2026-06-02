"""
Agent 5: Section Drafting Assistant — expands skeleton into full draft sections.
"""
import json
from app.ai.client import chat_complete
from app.ai.agents.draft_section_context import (
    ACADEMIC_SYSTEM_PROMPT,
    build_section_draft_context,
)


async def draft_section(
    section_name: str,
    section_type: str,
    call_requirements: str,
    evaluation_criteria: list[str] = None,
    retrieved_sections: list[dict] = None,
    style_exemplars: list[dict] = None,
    reusable_language: list[dict] = None,
    word_limit: int = None,
    user_instructions: str = "",
    funder: str = "",
    style_profile: dict | None = None,
    prior_sections_summary: str = "",
    citations: list[dict] | None = None,
    grant_idea: str = "",
    section_specific_requirements: dict | None = None,
    call_narrative_brief: str = "",
    skeleton_content: str = "",
    compliance_guidance: str = "",
    evidence_summary: str = "",
    narrative_context: dict | None = None,
    strategic_guidance: str = "",
    emphasis_direction: str = "",
    concept_bundles: list[dict] | None = None,
    writing_instructions: str = "",
    min_words: int | None = None,
    target_words: int | None = None,
    key_evidence: list | None = None,
    **kwargs,
) -> dict:
    ctx = build_section_draft_context(
        section_name=section_name,
        section_type=section_type,
        agent_kind="default",
        grant_idea=grant_idea,
        skeleton_content=skeleton_content,
        call_requirements=call_requirements,
        call_narrative_brief=call_narrative_brief,
        evaluation_criteria=evaluation_criteria,
        section_specific_requirements=section_specific_requirements,
        prior_sections_summary=prior_sections_summary,
        evidence_summary=evidence_summary,
        key_evidence=key_evidence,
        retrieved_sections=retrieved_sections,
        style_exemplars=style_exemplars,
        reusable_language=reusable_language,
        citations=citations,
        narrative_context=narrative_context,
        strategic_guidance=strategic_guidance,
        emphasis_direction=emphasis_direction,
        writing_instructions=writing_instructions,
        compliance_guidance=compliance_guidance,
        funder=funder,
        style_profile=style_profile,
        target_words=target_words,
        min_words=min_words,
        user_instructions=user_instructions,
    )

    response = await chat_complete(
        messages=[
            {"role": "system", "content": ctx.system_prompt},
            {"role": "user", "content": ctx.user_prompt},
        ],
        agent_name="section_drafter",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {
            "draft": response,
            "word_count": len(response.split()),
            "warnings": ["JSON parse failed"],
            "human_review_required": True,
        }
