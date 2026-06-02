"""Work package specialist for Horizon/EC-style calls."""
from __future__ import annotations
import json
from app.ai.client import chat_complete
from app.ai.agents.draft_section_context import build_section_draft_context


async def draft_work_packages_section(section_name: str, **kwargs) -> dict:
    ctx = build_section_draft_context(
        section_name=section_name,
        section_type="work_packages",
        agent_kind="work_packages",
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
        concept_bundles=kwargs.get("concept_bundles"),
        citations=kwargs.get("citations"),
        writing_instructions=kwargs.get("writing_instructions", ""),
        funder=kwargs.get("funder", ""),
        target_words=kwargs.get("target_words"),
        min_words=kwargs.get("min_words"),
        user_instructions=str(kwargs.get("required_subsections") or ""),
    )
    resp = await chat_complete(
        messages=[
            {"role": "system", "content": ctx.system_prompt},
            {"role": "user", "content": ctx.user_prompt},
        ],
        agent_name="work_package_agent",
        json_mode=True,
    )
    try:
        return json.loads(resp)
    except Exception:
        return {"draft": resp, "word_count": len(str(resp).split()), "warnings": []}
