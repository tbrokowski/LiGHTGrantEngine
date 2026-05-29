"""Route section drafting to specialized agents."""
from __future__ import annotations
from app.ai.agents.section_drafter import draft_section
from app.ai.agents.intro_architect import draft_introduction
from app.ai.agents.methods_agent import draft_methods_section
from app.ai.agents.work_package_agent import draft_work_packages_section
from app.ai.agents.impact_agent import draft_impact_section

INTRO_KEYWORDS = ("intro", "background", "problem", "executive", "rationale", "summary")


async def draft_section_routed(
    agent: str,
    section_name: str,
    is_intro: bool = False,
    **kwargs,
) -> dict:
    """Dispatch to the appropriate drafter."""
    if is_intro or agent == "intro":
        return await draft_introduction(
            grant_idea=kwargs.get("grant_idea", ""),
            call_requirements=kwargs.get("call_requirements", ""),
            evaluation_criteria=kwargs.get("evaluation_criteria"),
            style_profile=kwargs.get("style_profile"),
            style_exemplars=kwargs.get("style_exemplars"),
            retrieved_sections=kwargs.get("retrieved_sections"),
            citations=kwargs.get("citations"),
            funder=kwargs.get("funder", ""),
            word_limit=kwargs.get("target_words") or kwargs.get("word_limit"),
            skeleton_content=kwargs.get("skeleton_content", ""),
            compliance_guidance=kwargs.get("compliance_guidance", ""),
            evidence_summary=kwargs.get("evidence_summary", ""),
            narrative_context=kwargs.get("narrative_context"),
            opening_hook=kwargs.get("opening_hook", ""),
            strategic_framing=kwargs.get("strategic_framing", ""),
            concept_bundles=kwargs.get("concept_bundles"),
            min_words=kwargs.get("min_words"),
            writing_instructions=kwargs.get("writing_instructions", ""),
        )
    common = dict(kwargs)
    common["section_name"] = section_name
    if agent == "methods":
        return await draft_methods_section(**common)
    if agent == "work_packages":
        return await draft_work_packages_section(**common)
    if agent == "impact":
        return await draft_impact_section(**common)
    # budget + default → section_drafter
    return await draft_section(
        section_name=section_name,
        section_type=kwargs.get("section_type", "other"),
        call_requirements=kwargs.get("call_requirements", ""),
        evaluation_criteria=kwargs.get("evaluation_criteria"),
        retrieved_sections=kwargs.get("retrieved_sections"),
        style_exemplars=kwargs.get("style_exemplars"),
        reusable_language=kwargs.get("reusable_language"),
        word_limit=kwargs.get("target_words") or kwargs.get("word_limit"),
        funder=kwargs.get("funder", ""),
        style_profile=kwargs.get("style_profile"),
        prior_sections_summary=kwargs.get("prior_sections_summary", ""),
        citations=kwargs.get("citations"),
        grant_idea=kwargs.get("grant_idea", ""),
        section_specific_requirements=kwargs.get("section_specific_requirements"),
        call_narrative_brief=kwargs.get("call_narrative_brief", ""),
        skeleton_content=kwargs.get("skeleton_content", ""),
        compliance_guidance=kwargs.get("compliance_guidance", ""),
        evidence_summary=kwargs.get("evidence_summary", ""),
        narrative_context=kwargs.get("narrative_context"),
        strategic_guidance=kwargs.get("strategic_guidance", ""),
        emphasis_direction=kwargs.get("emphasis_direction", ""),
        concept_bundles=kwargs.get("concept_bundles"),
        writing_instructions=kwargs.get("writing_instructions", ""),
        min_words=kwargs.get("min_words"),
        target_words=kwargs.get("target_words"),
    )
