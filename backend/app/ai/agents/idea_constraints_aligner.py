"""
Idea Constraints Aligner — adjust section priorities and list based on grant idea + alignment.
"""
from __future__ import annotations

import json

from app.ai.client import chat_complete

MAX_ADDITIONAL_SECTIONS = 12

SYSTEM_PROMPT = f"""You align proposal section structure and word budget priorities with the team's grant idea.

Do NOT change the document's total word/page limit — you are re-partitioning it, not growing it.

You may:
- Boost priority on sections where the idea is strongest
- Suggest merging or skipping optional (non-required) sections only if the call allows
- Add rationale per section for the writing team
- Propose NEW, non-required sections when the grant idea describes distinct components,
  work packages, sub-projects, or themes that don't fit naturally under any existing section
  (e.g. the idea covers three separate interventions but the call only names one generic
  "Project Description" section). Only propose a new section when the idea genuinely warrants
  a dedicated section — do not fragment content that already fits an existing section.
  Propose at most {MAX_ADDITIONAL_SECTIONS} new sections total.

Priority order when the idea enumerates a fixed set of components:
- If the grant idea explicitly numbers or names a fixed set of work packages / components
  (e.g. "WP1", "WP2", ... or a numbered list of sub-projects), each one is its OWN section.
  Never collapse or drop any of them to make room for other proposed sections — they take
  priority over any inferred thematic section (dissemination, ethics, sustainability, etc.).
  Only fall back to merging enumerated components if the count exceeds the section budget above,
  and even then, cut inferred/thematic sections first, not the enumerated components.

Rules for new sections:
- Never rename, remove, or skip a REQUIRED call section.
- Never propose a name that duplicates or closely overlaps an existing section.
- Ground every proposed section in a specific part of the grant idea — name it in the rationale.

Return valid JSON only."""


async def align_constraints_to_idea(
    sections: list[dict],
    grant_idea: str,
    aligned_concept: dict | None = None,
    call_analysis: dict | None = None,
    call_intelligence: dict | None = None,
) -> dict:
    """
    Returns:
      {
        "sections": [updated section dicts with priority/rationale],
        "additional_sections": [{"name", "rationale", "priority"}] — new, idea-driven sections,
        "emphasis_notes": [str],
        "sections_deemphasized": [str]
      }
    """
    if not sections:
        return {"sections": [], "additional_sections": [], "emphasis_notes": [], "sections_deemphasized": []}

    alignment_snip = ""
    if aligned_concept:
        alignment_snip = json.dumps({
            "emphasis_areas": aligned_concept.get("emphasis_areas"),
            "gaps_to_address": aligned_concept.get("gaps_to_address"),
            "strengths_to_lead_with": aligned_concept.get("strengths_to_lead_with"),
        }, indent=2)[:2000]

    ci_snip = ""
    if call_intelligence:
        ci_snip = json.dumps({
            "grant_type_context": call_intelligence.get("grant_type_context"),
            "section_blueprint": [
                {"name": s.get("name"), "purpose": s.get("purpose")}
                for s in (call_intelligence.get("section_blueprint") or [])[:12]
                if isinstance(s, dict)
            ],
        }, indent=2)[:2000]

    user_prompt = f"""GRANT IDEA:
{(grant_idea or 'Not provided')[:8000]}

ALIGNMENT CONTEXT:
{alignment_snip or 'Not available'}

CALL INTELLIGENCE (funder's expected structure and grant type):
{ci_snip or 'Not available'}

CURRENT SECTION BUDGETS:
{json.dumps(sections, indent=2)[:5000]}

Required call sections: {(call_analysis or {}).get('required_sections', [])[:12]}

Return JSON:
- "sections": same names as CURRENT SECTION BUDGETS; adjust priority (high/medium/low) and add "rationale" per section.
- "additional_sections": new, non-required sections the idea warrants that aren't already covered above.
{{
  "sections": [...],
  "additional_sections": [
    {{"name": "...", "rationale": "why this needs its own section, citing the specific idea component", "priority": "high"|"medium"|"low"}}
  ],
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
        result = json.loads(response)
        result.setdefault("additional_sections", [])
        return result
    except Exception:
        return {"sections": sections, "additional_sections": [], "emphasis_notes": [], "sections_deemphasized": []}
