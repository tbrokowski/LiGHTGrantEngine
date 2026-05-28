"""
Planning Agent
Reads the user-edited skeleton and call requirements, then produces a per-section
research brief and overall narrative context that guide the research and draft subagents.
Runs once at the start of draft generation.
"""
import json
from app.ai.client import chat_complete

SYSTEM_PROMPT = """You are an expert research planning strategist for competitive grant proposals.

Given a grant proposal skeleton (sections with user-authored content) and call requirements, your job is to:
1. Understand the overall narrative and key claims the applicant is making
2. Identify what evidence, data, statistics, or citations each section needs to be compelling
3. Generate targeted web search queries and academic search queries for each section's research needs
4. Produce a concise narrative context that the section drafters should maintain as a through-line

You are NOT writing the proposal — you are planning what research support is needed to make
the user's skeleton content as strong as possible when it gets expanded into a full draft.

Respond with valid JSON."""

USER_PROMPT_TEMPLATE = """Analyze this proposal skeleton and call requirements to produce a research plan.

GRANT: {opportunity_title}
FUNDER: {funder}

GRANT IDEA:
{grant_idea}

CALL REQUIREMENTS (guidance for compliance coverage):
{call_requirements}

PROPOSAL SKELETON (user-authored — these are the sections and content the team has drafted):
{skeleton_sections}

---

For each section, identify:
- What key claims or assertions need supporting evidence or citations
- What statistics, data points, or recent findings would strengthen the argument
- 2–3 targeted web search queries to find supporting evidence (specific enough to return useful results)
- 1–2 academic search queries for peer-reviewed support (PubMed/OpenAlex style)
- Any compliance gaps relative to call requirements that the drafter should address

Also identify the overall narrative context: the core theory of change, the key differentiators of this
proposal, and any cross-section themes the drafters must maintain.

Return JSON with this structure:
{{
  "narrative_context": {{
    "theory_of_change": "...",
    "key_differentiators": ["...", "..."],
    "cross_section_themes": ["...", "..."],
    "funder_priorities_to_emphasize": ["...", "..."]
  }},
  "section_briefs": [
    {{
      "section_name": "...",
      "key_claims_to_support": ["...", "..."],
      "statistics_needed": ["...", "..."],
      "web_search_queries": ["query 1", "query 2"],
      "academic_search_queries": ["query 1"],
      "compliance_notes": "...",
      "priority": "high" | "medium" | "low"
    }}
  ]
}}"""


def _format_skeleton_sections(sections: list[dict]) -> str:
    lines = []
    for sec in sections:
        name = sec.get("name") or sec.get("title") or "Untitled"
        content = sec.get("content") or ""
        requirements = sec.get("requirements") or ""
        flagged = " [FLAGGED AS PRIORITY]" if sec.get("flagged") else ""
        lines.append(f"## {name}{flagged}")
        if requirements:
            lines.append(f"Coverage notes: {requirements}")
        lines.append(content[:1500] if content else "[No content yet]")
        lines.append("")
    return "\n".join(lines)


async def plan_draft_research(
    opportunity_title: str,
    funder: str,
    grant_idea: str,
    skeleton_sections: list[dict],
    call_requirements: str,
    flagged_section_names: list[str] | None = None,
) -> dict:
    """
    Produce a research and narrative plan for the draft generation phase.

    Returns:
      {
        "narrative_context": {...},
        "section_briefs": [{section_name, key_claims_to_support, web_search_queries,
                            academic_search_queries, compliance_notes, priority}, ...]
      }
    """
    # Mark flagged sections in the sections data so the prompt can emphasise them
    flagged_set = set(flagged_section_names or [])
    enriched_sections = []
    for sec in skeleton_sections:
        name = sec.get("name") or sec.get("title") or ""
        enriched_sections.append({**sec, "flagged": name in flagged_set})

    sections_str = _format_skeleton_sections(enriched_sections)

    user_prompt = USER_PROMPT_TEMPLATE.format(
        opportunity_title=opportunity_title,
        funder=funder or "Not specified",
        grant_idea=grant_idea or "Not provided",
        call_requirements=call_requirements[:3000] if call_requirements else "Not provided",
        skeleton_sections=sections_str,
    )

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="planning_agent",
        json_mode=True,
    )

    try:
        result = json.loads(response)
    except (json.JSONDecodeError, TypeError):
        result = {"narrative_context": {}, "section_briefs": []}

    # Ensure section_briefs covers all sections even if the LLM omitted some
    brief_names = {b.get("section_name") for b in result.get("section_briefs", [])}
    for sec in skeleton_sections:
        name = sec.get("name") or sec.get("title") or ""
        if name and name not in brief_names:
            result.setdefault("section_briefs", []).append({
                "section_name": name,
                "key_claims_to_support": [],
                "statistics_needed": [],
                "web_search_queries": [f"{name} {grant_idea[:80]} evidence statistics"],
                "academic_search_queries": [f"{name} {grant_idea[:60]}"],
                "compliance_notes": "",
                "priority": "medium",
            })

    return result
