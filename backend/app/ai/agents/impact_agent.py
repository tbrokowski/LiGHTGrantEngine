"""Impact / dissemination / sustainability drafter."""
from __future__ import annotations
import json
from app.ai.client import chat_complete
from app.ai.agents.draft_drafting_shared import format_evidence_context, word_target_block

SYSTEM = """You write impact, dissemination, and sustainability sections with theory of change,
pathways to impact, indicators, and stakeholder engagement. Specific and measurable."""

async def draft_impact_section(section_name: str, **kwargs) -> dict:
    ctx = format_evidence_context(
        kwargs.get("retrieved_sections"),
        kwargs.get("style_exemplars"),
        kwargs.get("reusable_language"),
        kwargs.get("concept_bundles"),
        kwargs.get("evidence_summary", ""),
        kwargs.get("citations"),
    )
    tw, mn = kwargs.get("target_words"), kwargs.get("min_words")
    prompt = f"""Draft {section_name}.
{word_target_block(tw, mn)}
IDEA: {(kwargs.get('grant_idea') or '')[:4000]}
SKELETON: {(kwargs.get('skeleton_content') or '')[:5000]}
{ctx}
Return JSON: draft, word_count, warnings"""
    resp = await chat_complete(
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        agent_name="impact_agent",
        json_mode=True,
    )
    try:
        return json.loads(resp)
    except Exception:
        return {"draft": resp, "word_count": len(str(resp).split()), "warnings": []}
