"""Methods / methodology specialist drafter."""
from __future__ import annotations
import json
from app.ai.client import chat_complete
from app.ai.agents.draft_drafting_shared import format_evidence_context, word_target_block

SYSTEM = """You are an expert methods section writer for competitive health/AI grant proposals.
Write rigorous methodology: study design, population, data, analysis, ethics, limitations.
Use full paragraphs, specific numbers, named technologies. Cite evidence provided."""

async def draft_methods_section(
    section_name: str,
    skeleton_content: str = "",
    grant_idea: str = "",
    call_requirements: str = "",
    evaluation_criteria: list | None = None,
    retrieved_sections: list | None = None,
    style_exemplars: list | None = None,
    reusable_language: list | None = None,
    concept_bundles: list | None = None,
    evidence_summary: str = "",
    citations: list | None = None,
    target_words: int | None = None,
    min_words: int | None = None,
    writing_instructions: str = "",
    strategic_guidance: str = "",
    funder: str = "",
    **kwargs,
) -> dict:
    ctx = format_evidence_context(
        retrieved_sections, style_exemplars, reusable_language,
        concept_bundles, evidence_summary, citations,
    )
    prompt = f"""Draft the {section_name} section.

FUNDER: {funder}
{word_target_block(target_words, min_words)}

GRANT IDEA:
{grant_idea[:4000]}

SKELETON (expand, do not replace):
{skeleton_content[:6000]}

{writing_instructions}
{strategic_guidance}

CALL (guidance): {call_requirements[:3000]}
CRITERIA: {evaluation_criteria or []}

{ctx}

Structure with clear subsections: Design, Population/Setting, Data & Measures, Analysis, Ethics, Limitations.
Return JSON: draft, word_count, sources_used, warnings, human_review_required"""
    resp = await chat_complete(
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        agent_name="methods_agent",
        json_mode=True,
    )
    try:
        return json.loads(resp)
    except Exception:
        return {"draft": resp, "word_count": len(str(resp).split()), "warnings": [], "human_review_required": True}
