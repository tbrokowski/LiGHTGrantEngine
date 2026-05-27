"""
Agent 10: Institutional Memory Agent
Processes completed grants to extract reusable knowledge and archive summaries.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an institutional memory curator for a research group.
Your job is to extract lasting knowledge from completed grant cycles.
Be systematic and future-oriented. Respond with valid JSON."""


def _format_sections_for_memory(split_sections: list | None, submitted_text: str) -> str:
    """Build section-aware text for memory extraction."""
    if split_sections:
        parts = []
        for sec in split_sections[:50]:
            title = sec.get("title") or sec.get("section_type") or "Section"
            stype = sec.get("section_type") or "other"
            body = sec.get("text") or ""
            excerpt = body[:4000] + ("..." if len(body) > 4000 else "")
            parts.append(f"## {title} ({stype})\n{excerpt}")
        return "\n\n".join(parts)

    return submitted_text.strip()


async def process_completed_grant(
    grant_title: str,
    funder: str,
    outcome: str,
    submitted_text: str = "",
    reviewer_feedback: str = "",
    internal_notes: str = "",
    split_sections: list | None = None,
) -> dict:
    section_text = _format_sections_for_memory(split_sections, submitted_text)

    user_prompt = f"""Process this completed grant for institutional memory.

GRANT: {grant_title}
FUNDER: {funder}
OUTCOME: {outcome}

SUBMITTED TEXT (by section):
{section_text[:100000]}

REVIEWER FEEDBACK:
{reviewer_feedback[:8000]}

INTERNAL NOTES:
{internal_notes[:4000]}

Extract:
- archive_summary: 2-3 sentence summary for future reference
- reusable_language_candidates: list of {{title, type, text}} passages worth preserving
- lessons_learned: list of specific lessons for future grants
- funder_notes: what we learned about this funder's preferences
- tags: thematic tags for retrieval
- recommended_future_actions: what to do differently next time
- updated_funder_profile: key facts to add to funder profile
- resubmission_worthy: bool — should we track for resubmission?

Return as JSON."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="memory_agent",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"error": "Processing failed", "raw": response}
