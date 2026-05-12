"""
Agent 10: Institutional Memory Agent
Processes completed grants to extract reusable knowledge and archive summaries.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an institutional memory curator for a research group.
Your job is to extract lasting knowledge from completed grant cycles.
Be systematic and future-oriented. Respond with valid JSON."""

async def process_completed_grant(
    grant_title: str,
    funder: str,
    outcome: str,
    submitted_text: str = "",
    reviewer_feedback: str = "",
    internal_notes: str = "",
) -> dict:
    user_prompt = f"""Process this completed grant for institutional memory.

GRANT: {grant_title}
FUNDER: {funder}
OUTCOME: {outcome}

SUBMITTED TEXT (excerpt):
{submitted_text[:4000]}

REVIEWER FEEDBACK:
{reviewer_feedback[:2000]}

INTERNAL NOTES:
{internal_notes[:1000]}

Extract:
- archive_summary: 2-3 sentence summary for future reference
- reusable_language_candidates: list of sections/passages worth preserving with their type
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
