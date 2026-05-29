"""Work package specialist for Horizon/EC-style calls."""
from __future__ import annotations
import json
from app.ai.client import chat_complete
from app.ai.agents.draft_drafting_shared import format_evidence_context, word_target_block

SYSTEM = """You write work package sections for EU/Horizon-style grants.
For each WP include: objectives, tasks, deliverables (with codes if applicable), milestones, PM allocation.
Use tables in HTML where helpful (<table><tr><th>...</th></tr>).
Be specific to the team's idea — not generic WP templates."""

async def draft_work_packages_section(
    section_name: str,
    skeleton_content: str = "",
    grant_idea: str = "",
    call_requirements: str = "",
    required_subsections: list | None = None,
    retrieved_sections: list | None = None,
    concept_bundles: list | None = None,
    evidence_summary: str = "",
    citations: list | None = None,
    target_words: int | None = None,
    min_words: int | None = None,
    writing_instructions: str = "",
    funder: str = "",
    **kwargs,
) -> dict:
    ctx = format_evidence_context(retrieved_sections, None, None, concept_bundles, evidence_summary, citations)
    subs = required_subsections or []
    prompt = f"""Draft {section_name} with detailed work packages.

FUNDER: {funder}
{word_target_block(target_words, min_words)}

IDEA: {grant_idea[:4000]}
SKELETON: {skeleton_content[:5000]}
REQUIRED STRUCTURE: {subs}
{writing_instructions}
{ctx}

Return JSON: draft (HTML with WP tables), word_count, warnings"""
    resp = await chat_complete(
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        agent_name="work_package_agent",
        json_mode=True,
    )
    try:
        return json.loads(resp)
    except Exception:
        return {"draft": resp, "word_count": len(str(resp).split()), "warnings": []}
