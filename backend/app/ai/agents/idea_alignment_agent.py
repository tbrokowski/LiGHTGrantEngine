"""
Idea Alignment Agent
Takes the grant idea and the call strategy brief and produces an "aligned concept" —
the idea reframed through the lens of funder priorities, with gaps identified and
emphasis areas surfaced. Runs as Stage 3 of the intelligent skeleton pipeline.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a senior grant strategist helping a research team strengthen their proposal concept.

Your job is NOT to rewrite the team's idea — it is to identify how to FRAME and EMPHASIZE the existing
idea so it resonates most strongly with this specific funder's priorities.

Preserve the team's voice, scientific direction, and core claims. Add strategic framing.

Respond with valid JSON."""


async def align_idea_to_call(
    grant_idea: str,
    call_strategy: dict,
    narrative_brief: str = "",
    funder: str = "",
    opportunity_title: str = "",
) -> dict:
    """
    Align the grant idea to the call strategy brief.

    Returns:
      {
        "aligned_framing": str — how the idea should be framed (2-3 paragraphs),
        "emphasis_areas": list of {section, emphasis, why} dicts,
        "gaps_to_address": list of strings — what the call requires that the idea doesn't cover yet,
        "strengths_to_lead_with": list of strings — strongest alignment points to foreground,
        "opening_hook": str — suggested 2-3 sentence opening for the introduction/background section,
        "title_direction": str — direction for a compelling proposal title
      }
    """
    strategy_str = _format_strategy(call_strategy)

    user_prompt = f"""You are helping align a grant idea with a specific funder's priorities.

OPPORTUNITY: {opportunity_title}
FUNDER: {funder}

TEAM'S GRANT IDEA:
{grant_idea or 'Not provided — use available context'}

CALL NARRATIVE BRIEF:
{narrative_brief[:1500] if narrative_brief else 'Not provided'}

CALL STRATEGY BRIEF (what a winning proposal must do):
{strategy_str}

Produce an alignment analysis in JSON with these fields:

- aligned_framing: 2-3 paragraphs of text describing how this specific idea should be framed
  for this call. Preserve the team's scientific direction but add strategic positioning language.
  Reference specific funder priorities where they align with the idea.

- emphasis_areas: list of objects for the proposal's key sections, each with:
    {{"section": "section name", "emphasis": "what to lead with and foreground in this section", "why": "why this resonates with the funder"}}
  Provide 4-6 entries for the most important sections.

- gaps_to_address: list of 3-6 strings — things the call explicitly requires or prioritizes that
  the current idea description doesn't address. These need to be incorporated in the skeleton.

- strengths_to_lead_with: list of 3-5 strings — the strongest alignment points between the idea
  and funder priorities. These should be prominently featured.

- opening_hook: a 2-3 sentence opening paragraph for the Introduction or Background section that
  connects the problem the team is solving to the funder's specific mission and priorities.
  Write in proposal prose style.

- title_direction: a brief description (not the full title) of what makes a compelling title
  for this proposal given the funder's priorities, plus 1-2 title suggestions.

Return valid JSON only."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="idea_alignment_agent",
        json_mode=True,
    )

    try:
        return json.loads(response)
    except (json.JSONDecodeError, TypeError):
        return {}


def _format_strategy(strategy: dict) -> str:
    parts = []

    if strategy.get("narrative_framing"):
        parts.append(f"OVERALL FRAMING: {strategy['narrative_framing']}")

    if strategy.get("critical_themes"):
        parts.append("CRITICAL THEMES (priority order):\n" + "\n".join(
            f"{i+1}. {t}" for i, t in enumerate(strategy["critical_themes"])
        ))

    if strategy.get("must_demonstrate"):
        parts.append("MUST DEMONSTRATE:\n" + "\n".join(f"- {d}" for d in strategy["must_demonstrate"][:6]))

    if strategy.get("winning_differentiators"):
        parts.append("WINNING DIFFERENTIATORS:\n" + "\n".join(f"- {d}" for d in strategy["winning_differentiators"]))

    if strategy.get("red_flags"):
        parts.append("RED FLAGS TO AVOID:\n" + "\n".join(f"- {r}" for r in strategy["red_flags"]))

    return "\n\n".join(parts) if parts else "Strategy brief not available"
