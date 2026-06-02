"""Impact / dissemination / sustainability drafter."""
from __future__ import annotations
import json
from app.ai.client import chat_complete
from app.ai.agents.draft_section_context import build_section_draft_context


async def draft_impact_section(section_name: str, **kwargs) -> dict:
    ctx = build_section_draft_context(
        section_name=section_name,
        section_type=kwargs.get("section_type", "impact"),
        agent_kind="impact",
        grant_idea=kwargs.get("grant_idea", ""),
        skeleton_content=kwargs.get("skeleton_content", ""),
        call_requirements=kwargs.get("call_requirements", ""),
        call_narrative_brief=kwargs.get("call_narrative_brief", ""),
        evaluation_criteria=kwargs.get("evaluation_criteria"),
        section_specific_requirements=kwargs.get("section_specific_requirements"),
        prior_sections_summary=kwargs.get("prior_sections_summary", ""),
        evidence_summary=kwargs.get("evidence_summary", ""),
        key_evidence=kwargs.get("key_evidence"),
        retrieved_sections=kwargs.get("retrieved_sections"),
        style_exemplars=kwargs.get("style_exemplars"),
        reusable_language=kwargs.get("reusable_language"),
        concept_bundles=kwargs.get("concept_bundles"),
        citations=kwargs.get("citations"),
        narrative_context=kwargs.get("narrative_context"),
        strategic_guidance=kwargs.get("strategic_guidance", ""),
        emphasis_direction=kwargs.get("emphasis_direction", ""),
        writing_instructions=kwargs.get("writing_instructions", ""),
        funder=kwargs.get("funder", ""),
        style_profile=kwargs.get("style_profile"),
        target_words=kwargs.get("target_words"),
        min_words=kwargs.get("min_words"),
    )
    resp = await chat_complete(
        messages=[
            {"role": "system", "content": ctx.system_prompt},
            {"role": "user", "content": ctx.user_prompt},
        ],
        agent_name="impact_agent",
        json_mode=True,
    )
    try:
        return json.loads(resp)
    except Exception:
        return {"draft": resp, "word_count": len(str(resp).split()), "warnings": []}
