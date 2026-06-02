"""Route section drafting to specialized agents."""
from __future__ import annotations
from app.ai.agents.section_drafter import draft_section
from app.ai.agents.intro_architect import draft_introduction
from app.ai.agents.methods_agent import draft_methods_section
from app.ai.agents.work_package_agent import draft_work_packages_section
from app.ai.agents.impact_agent import draft_impact_section

INTRO_KEYWORDS = ("intro", "background", "problem", "executive", "rationale", "summary")


def _common_kwargs(kwargs: dict) -> dict:
    return {
        "grant_idea": kwargs.get("grant_idea", ""),
        "call_requirements": kwargs.get("call_requirements", ""),
        "call_narrative_brief": kwargs.get("call_narrative_brief", ""),
        "evaluation_criteria": kwargs.get("evaluation_criteria"),
        "retrieved_sections": kwargs.get("retrieved_sections"),
        "style_exemplars": kwargs.get("style_exemplars"),
        "reusable_language": kwargs.get("reusable_language"),
        "concept_bundles": kwargs.get("concept_bundles"),
        "evidence_summary": kwargs.get("evidence_summary", ""),
        "key_evidence": kwargs.get("key_evidence"),
        "citations": kwargs.get("citations"),
        "prior_sections_summary": kwargs.get("prior_sections_summary", ""),
        "section_specific_requirements": kwargs.get("section_specific_requirements"),
        "narrative_context": kwargs.get("narrative_context"),
        "strategic_guidance": kwargs.get("strategic_guidance", ""),
        "emphasis_direction": kwargs.get("emphasis_direction", ""),
        "writing_instructions": kwargs.get("writing_instructions", ""),
        "compliance_guidance": kwargs.get("compliance_guidance", ""),
        "skeleton_content": kwargs.get("skeleton_content", ""),
        "funder": kwargs.get("funder", ""),
        "style_profile": kwargs.get("style_profile"),
        "target_words": kwargs.get("target_words"),
        "min_words": kwargs.get("min_words"),
        "opening_hook": kwargs.get("opening_hook", ""),
        "strategic_framing": kwargs.get("strategic_framing", ""),
    }


async def draft_section_routed(
    agent: str,
    section_name: str,
    is_intro: bool = False,
    **kwargs,
) -> dict:
    """Dispatch to the appropriate drafter."""
    common = _common_kwargs(kwargs)
    if is_intro or agent == "intro":
        return await draft_introduction(**common)
    common["section_name"] = section_name
    if agent == "methods":
        return await draft_methods_section(**common)
    if agent == "work_packages":
        return await draft_work_packages_section(
            **common,
            required_subsections=kwargs.get("required_subsections"),
        )
    if agent == "impact":
        return await draft_impact_section(**common)
    return await draft_section(
        section_name=section_name,
        section_type=kwargs.get("section_type", "other"),
        word_limit=kwargs.get("target_words") or kwargs.get("word_limit"),
        user_instructions=kwargs.get("user_instructions", ""),
        **common,
    )
