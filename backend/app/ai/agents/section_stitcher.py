"""Merge subsection drafts into one coherent section."""
from __future__ import annotations
import json
from app.ai.client import chat_complete

async def stitch_subsections(
    section_name: str,
    subsection_drafts: list[dict],
    target_words: int,
) -> str:
    parts = []
    for sd in subsection_drafts:
        parts.append(f"### {sd.get('title', 'Part')}\n{sd.get('draft', '')}")
    combined = "\n\n".join(parts)
    prompt = f"""Merge these subsection drafts into one cohesive "{section_name}" section (~{target_words} words).
Use h3 for subsection titles. Remove redundancy. Keep all specific claims and citations.

SUBSECTIONS:
{combined[:25000]}

Return JSON: {{"draft": "single HTML section"}}"""
    resp = await chat_complete(
        messages=[{"role": "user", "content": prompt}],
        agent_name="section_stitcher",
        json_mode=True,
    )
    try:
        return json.loads(resp).get("draft") or combined
    except Exception:
        return combined
