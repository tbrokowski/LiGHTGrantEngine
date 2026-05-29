"""
Meeting Prep Agent — generates a structured meeting briefing before a partner meeting.
Output covers: research background, recent interaction history, talking points,
questions to ask, and what you need from them in the context of open grants.
"""
import json
from typing import Optional

from app.ai.client import chat_complete


SYSTEM_PROMPT = """You are a research partnership advisor preparing a team member for a meeting
with a research partner. Generate a concise, actionable meeting briefing in structured JSON.
Focus on practical preparation: what to know, what to ask, what to achieve."""


async def generate_meeting_prep(
    partner: dict,
    meeting_title: str,
    agenda: list[str],
    recent_logs: list[dict],
    grant_context: Optional[str] = None,
) -> str:
    """
    Generate a meeting preparation briefing.

    Args:
        partner: {name, title, organization, tags, notes, h_index}
        meeting_title: Title of the meeting
        agenda: List of agenda items
        recent_logs: Last 5 contact log entries [{type, date, notes}]
        grant_context: Optional "grant:{id}" or "opportunity:{id}"

    Returns:
        Formatted markdown string with the briefing
    """
    partner_summary = f"""Name: {partner.get('name')}
Title: {partner.get('title', 'N/A')}
Organization: {partner.get('organization', 'N/A')}
Expertise: {', '.join(partner.get('tags', []))}
h-index: {partner.get('h_index', 'N/A')}
Notes: {partner.get('notes', 'None')[:500] if partner.get('notes') else 'None'}"""

    recent_history = ""
    if recent_logs:
        history_lines = []
        for log in recent_logs:
            history_lines.append(f"- [{log.get('type', 'note')} on {log.get('date', '?')[:10]}] {log.get('notes', '')[:200]}")
        recent_history = "\n".join(history_lines)
    else:
        recent_history = "No recent interactions logged."

    agenda_str = "\n".join(f"- {item}" for item in agenda) if agenda else "No agenda set."
    grant_str = f"\nGrant/opportunity context: {grant_context}" if grant_context else ""

    user_prompt = f"""Prepare a meeting briefing for the following meeting:

MEETING: {meeting_title}
AGENDA:
{agenda_str}
{grant_str}

PARTNER PROFILE:
{partner_summary}

RECENT INTERACTIONS:
{recent_history}

Generate a meeting prep briefing as a JSON object:
{{
  "background_summary": "2-3 sentences on this person's research focus and why they matter",
  "relationship_status": "1 sentence on where the relationship currently stands based on interactions",
  "talking_points": ["point 1", "point 2", "point 3"],
  "questions_to_ask": ["question 1", "question 2", "question 3"],
  "what_you_need": "What you want to achieve or request from this meeting",
  "potential_concerns": "Any sensitivities or things to be careful about",
  "preparation_checklist": ["item 1", "item 2"]
}}"""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="meeting_prep",
            json_mode=True,
        )
        data = json.loads(response)

        # Format as clean markdown
        lines = []
        lines.append(f"## Meeting Briefing: {meeting_title}\n")

        if data.get("background_summary"):
            lines.append(f"### About {partner.get('name', 'this partner')}")
            lines.append(data["background_summary"])
            lines.append("")

        if data.get("relationship_status"):
            lines.append("### Relationship Status")
            lines.append(data["relationship_status"])
            lines.append("")

        if data.get("talking_points"):
            lines.append("### Key Talking Points")
            for tp in data["talking_points"]:
                lines.append(f"- {tp}")
            lines.append("")

        if data.get("questions_to_ask"):
            lines.append("### Questions to Ask")
            for q in data["questions_to_ask"]:
                lines.append(f"- {q}")
            lines.append("")

        if data.get("what_you_need"):
            lines.append("### What You Need from This Meeting")
            lines.append(data["what_you_need"])
            lines.append("")

        if data.get("potential_concerns"):
            lines.append("### ⚠ Things to Note")
            lines.append(data["potential_concerns"])
            lines.append("")

        if data.get("preparation_checklist"):
            lines.append("### Pre-Meeting Checklist")
            for item in data["preparation_checklist"]:
                lines.append(f"- [ ] {item}")

        return "\n".join(lines)
    except Exception as e:
        return f"## Meeting Briefing\n\nCould not generate briefing: {str(e)}"
