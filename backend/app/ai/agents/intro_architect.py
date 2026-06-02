"""
Intro Architect — expands skeleton into full introduction following 6-beat arc.
"""
import json
from app.ai.client import chat_complete
from app.ai.context.grant_context import DEFAULT_INTRO_ARC
from app.ai.agents.draft_section_context import build_section_draft_context


async def draft_introduction(
    grant_idea: str,
    call_requirements: str,
    evaluation_criteria: list[str] = None,
    intro_arc: list[dict] | None = None,
    style_profile: dict | None = None,
    style_exemplars: list[dict] | None = None,
    retrieved_sections: list[dict] | None = None,
    citations: list[dict] | None = None,
    funder: str = "",
    word_limit: int | None = None,
    skeleton_content: str = "",
    compliance_guidance: str = "",
    evidence_summary: str = "",
    narrative_context: dict | None = None,
    user_instructions: str = "",
    opening_hook: str = "",
    strategic_framing: str = "",
    concept_bundles: list[dict] | None = None,
    min_words: int | None = None,
    writing_instructions: str = "",
    section_specific_requirements: dict | None = None,
    call_narrative_brief: str = "",
    prior_sections_summary: str = "",
    key_evidence: list | None = None,
    target_words: int | None = None,
    **kwargs,
) -> dict:
    arc = intro_arc or DEFAULT_INTRO_ARC
    arc_str = "\n".join(
        f"{i + 1}. {beat.get('label', beat.get('beat', ''))}: {beat.get('guidance', '')}"
        for i, beat in enumerate(arc)
    )

    ctx = build_section_draft_context(
        section_name="Introduction",
        section_type="introduction",
        agent_kind="intro",
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
        citations=citations,
        narrative_context=narrative_context,
        opening_hook=opening_hook,
        strategic_framing=strategic_framing,
        concept_bundles=concept_bundles,
        writing_instructions=writing_instructions,
        compliance_guidance=compliance_guidance,
        funder=funder,
        style_profile=style_profile,
        target_words=target_words or word_limit,
        min_words=min_words,
        user_instructions=user_instructions,
        intro_arc_str=arc_str,
    )

    user_prompt = ctx.user_prompt + "\n\nFollow all 6 beats in order. Return JSON with draft, beats_covered, citations_used, word_count, warnings."

    response = await chat_complete(
        messages=[
            {"role": "system", "content": ctx.system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="intro_architect",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"draft": "", "error": "Intro drafting failed", "raw": response}
