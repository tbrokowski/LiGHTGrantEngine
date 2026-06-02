"""
Idea Constraints Aligner — adjust section priorities and list based on grant idea + alignment.
"""
from __future__ import annotations

import json

from app.ai.client import chat_complete

SYSTEM_PROMPT = """You align proposal section structure and word budget priorities with the team's grant idea.

Do NOT change total word/page limits. You may:
- Boost priority on sections where the idea is strongest
- Suggest merging or skipping optional sections only if the call allows
- Add rationale per section for the writing team

Return valid JSON only."""


async def align_constraints_to_idea(
    sections: list[dict],
    grant_idea: str,
    aligned_concept: dict | None = None,
    call_analysis: dict | None = None,
) -> dict:
    """
    Returns:
      {
        "sections": [updated section dicts with priority/rationale],
        "emphasis_notes": [str],
        "sections_deemphasized": [str]
      }
    """
    if not sections:
        return {"sections": [], "emphasis_notes": [], "sections_deemphasized": []}

    alignment_snip = ""
    if aligned_concept:
        alignment_snip = json.dumps({
            "emphasis_areas": aligned_concept.get("emphasis_areas"),
            "gaps_to_address": aligned_concept.get("gaps_to_address"),
            "strengths_to_lead_with": aligned_concept.get("strengths_to_lead_with"),
        }, indent=2)[:2000]

    user_prompt = f"""GRANT IDEA:
{(grant_idea or 'Not provided')[:3000]}

ALIGNMENT CONTEXT:
{alignment_snip or 'Not available'}

CURRENT SECTION BUDGETS:
{json.dumps(sections, indent=2)[:5000]}

Required call sections: {(call_analysis or {}).get('required_sections', [])[:12]}

Return JSON with same section names; adjust priority (high/medium/low) and add "rationale" per section.
{{
  "sections": [...],
  "emphasis_notes": ["..."],
  "sections_deemphasized": ["optional section names lowered in priority"]
}}"""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="idea_constraints_aligner",
            json_mode=True,
        )
        return json.loads(response)
    except Exception:
        return {"sections": sections, "emphasis_notes": [], "sections_deemphasized": []}
