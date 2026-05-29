"""
Call Strategy Agent
Reads the full call_analysis JSON (all fields from the two-stage analyzer) and
produces a "winning proposal brief" — a concise strategic synthesis for the skeleton
generator to use. Runs as Stage 2 of the intelligent skeleton pipeline.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are a senior grants strategist with deep expertise in winning competitive proposals.

Given a fully analyzed grant call document, your task is to synthesize a strategic brief that tells a
proposal team exactly what a winning proposal for this specific call must look like.

Go beyond summarizing requirements — identify the strategic framing, emphasis, and differentiation
that will make a proposal stand out to this specific funder.

Respond with valid JSON."""


async def build_call_strategy(
    call_analysis: dict,
    call_requirements_text: str = "",
    funder: str = "",
    opportunity_title: str = "",
    grant_type_context: str = "",
) -> dict:
    """
    Synthesize a call strategy brief from the full call_analysis dict.

    Returns:
      {
        "critical_themes": list of ordered priority themes/topics (most important first),
        "must_demonstrate": list of things a winning proposal must prove/show,
        "section_strategy": dict mapping section name to strategic guidance string,
        "key_phrases_to_echo": list of exact funder phrases to use in the proposal,
        "winning_differentiators": list of what would make a proposal stand out,
        "red_flags": list of common weaknesses to avoid for this call,
        "narrative_framing": 2-3 sentence synthesis of how a winning proposal should be framed overall
      }
    """
    # Build a rich summary from the full analysis fields
    analysis_summary = _format_full_analysis(call_analysis)

    call_intelligence_section = (
        f"\nCALL INTELLIGENCE (from meta-analysis — what wins for this specific call):\n{grant_type_context}"
        if grant_type_context else ""
    )

    user_prompt = f"""You are building a strategic brief to guide skeleton generation for a grant proposal.

OPPORTUNITY: {opportunity_title}
FUNDER: {funder}{call_intelligence_section}

FULL CALL ANALYSIS:
{analysis_summary}

CALL REQUIREMENTS TEXT:
{call_requirements_text[:3000] if call_requirements_text else 'Not provided'}

Based on this complete analysis, produce a strategic brief in JSON with these fields:

- critical_themes: ordered list of 5-8 strings — the themes/topics the funder cares most about,
  ordered from highest to lowest priority. These are what proposal content must be built around.

- must_demonstrate: list of 6-10 strings — specific things a winning proposal must PROVE or SHOW
  (not just mention). Each should be concrete and actionable.

- section_strategy: object mapping each required/expected section name to a 2-3 sentence
  strategic guidance string: what this section specifically needs to achieve for THIS call,
  beyond generic requirements.

- key_phrases_to_echo: list of 5-8 exact phrases from the funder's language (from key_phrases
  or elsewhere in the call) that the proposal should explicitly use to signal alignment.

- winning_differentiators: list of 4-6 strings — what would make a proposal genuinely stand out
  from average submissions for this specific call. Be specific to this funder/call.

- red_flags: list of 3-5 strings — common mistakes or weaknesses that would hurt a proposal's
  chances for THIS specific call.

- narrative_framing: a 2-3 sentence description of how the overall proposal narrative should be
  framed — the opening hook, the main argument, and the closing impact statement approach.

Return valid JSON only."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="call_strategy_agent",
        json_mode=True,
    )

    try:
        return json.loads(response)
    except (json.JSONDecodeError, TypeError):
        return {}


def _format_full_analysis(analysis: dict) -> str:
    """Format the full call_analysis dict for the strategy prompt."""
    parts = []

    if analysis.get("narrative_brief"):
        parts.append(f"NARRATIVE BRIEF:\n{analysis['narrative_brief']}")

    if analysis.get("funder_priorities"):
        parts.append("FUNDER PRIORITIES (ordered):\n" + "\n".join(f"{i+1}. {p}" for i, p in enumerate(analysis["funder_priorities"])))

    if analysis.get("strategic_objectives"):
        parts.append("STRATEGIC OBJECTIVES:\n" + "\n".join(f"- {o}" for o in analysis["strategic_objectives"]))

    if analysis.get("call_background"):
        parts.append("CALL BACKGROUND:\n" + "\n".join(f"- {b}" for b in analysis["call_background"][:5]))

    if analysis.get("requirements_overview"):
        parts.append("REQUIREMENTS OVERVIEW:\n" + "\n".join(f"- {r}" for r in analysis["requirements_overview"]))

    if analysis.get("evaluation_criteria"):
        parts.append("EVALUATION CRITERIA:\n" + "\n".join(f"- {c}" for c in analysis["evaluation_criteria"]))

    if analysis.get("key_focus_areas"):
        areas = analysis["key_focus_areas"]
        parts.append("KEY FOCUS AREAS:\n" + "\n".join(
            f"- {a.get('area', '')}: {a.get('description', '')} ({a.get('why_it_matters', '')})"
            for a in areas[:6]
        ))

    if analysis.get("key_phrases"):
        phrases = analysis["key_phrases"]
        parts.append("KEY PHRASES FROM FUNDER:\n" + "\n".join(
            f'- "{p.get("phrase", "")}" ({p.get("significance", "")})'
            for p in phrases[:8]
        ))

    if analysis.get("section_requirements"):
        sec_reqs = analysis["section_requirements"]
        parts.append("SECTION REQUIREMENTS:\n" + "\n".join(
            f"- {sec}: {details.get('requirements', '')} [{details.get('priority', 'medium')} priority]"
            for sec, details in list(sec_reqs.items())[:8]
            if isinstance(details, dict)
        ))

    if analysis.get("required_sections"):
        parts.append("REQUIRED SECTIONS: " + ", ".join(analysis["required_sections"][:10]))

    if analysis.get("budget_constraints"):
        parts.append(f"BUDGET: {analysis['budget_constraints']}")

    if analysis.get("risks"):
        parts.append("RISKS TO ADDRESS:\n" + "\n".join(f"- {r}" for r in analysis["risks"][:4]))

    return "\n\n".join(parts) if parts else "Full analysis not available"
