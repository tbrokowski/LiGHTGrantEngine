"""
Deep Review Agent — on-demand LLM analysis of a grant opportunity.

Only called when the user explicitly clicks "Deep Review" on an opportunity.
Produces a comprehensive strategic assessment including fit score, strengths,
risks, proposal strategy, critical requirements, archive references, and a
Go / No-Go recommendation.
"""
import json
from app.ai.client import chat_complete
from app.schemas.grant_profile import GrantProfile

SYSTEM_PROMPT = """You are a senior grant strategist and proposal expert for a research institution.
When evaluating a grant opportunity you produce a thorough, actionable review that a PI can
act on immediately. You combine thematic fit analysis with concrete proposal strategy advice.

Your output must cover every field in the JSON schema below — no field may be omitted.

Schema:
{
  "fit_score": <integer 0-100>,
  "priority": <"high_priority" | "worth_reviewing" | "watchlist" | "low_fit">,
  "verdict": <one-sentence verdict, e.g. "Strong match — proceed to proposal">,
  "score_breakdown": {
    "thematic_alignment":   <0-35, integer>,
    "eligibility_match":    <0-20, integer>,
    "deadline_feasibility": <0-10, integer>,
    "strategic_funder":     <0-10, integer>,
    "award_appropriateness":<0-10, integer>,
    "geographic_relevance": <0-10, integer>,
    "partner_feasibility":  <0-5,  integer>
  },
  "strengths": [<string>, ...],
  "risks": [<string>, ...],
  "proposal_strategy": <paragraph with specific narrative recommendations>,
  "critical_requirements": [<string>, ...],
  "archive_references": [<string>, ...],
  "go_no_go": <"GO" | "NO-GO" | "CONDITIONAL GO">,
  "go_no_go_rationale": <2-3 sentence rationale>,
  "recommended_sections": [<string>, ...]
}

Tiers: 80-100 = high_priority, 60-79 = worth_reviewing, 40-59 = watchlist, <40 = low_fit
Respond ONLY with valid JSON matching the schema above."""


async def deep_review_opportunity(
    title: str,
    description: str,
    funder: str = "",
    eligibility: str = "",
    evaluation_criteria: str = "",
    geography: str = "",
    award_amount: str = "",
    deadline: str = "",
    profile: GrantProfile | None = None,
    archive_context: str = "",
) -> dict:
    profile = profile or GrantProfile()
    themes = ", ".join(profile.keywords[:20]) or "general research"
    geos = ", ".join(profile.geographies) or "global"
    institution = profile.institution_name or "the research institution"
    projects = profile.projects or "Not specified"

    archive_section = (
        f"\nPAST AWARDED GRANTS (for calibration):\n{archive_context}\n"
        if archive_context
        else ""
    )

    user_prompt = f"""Perform a deep strategic review of this grant opportunity for {institution}.

INSTITUTION PROFILE:
- Name: {institution}
- Core research themes / keywords: {themes}
- Target geographies: {geos}
- Active projects and context: {projects}
{archive_section}
OPPORTUNITY:
Title: {title}
Funder: {funder}
Description: {description[:4000]}
Eligibility: {eligibility[:800]}
Evaluation criteria: {evaluation_criteria[:600]}
Geography: {geography}
Award amount: {award_amount}
Deadline: {deadline}

Provide your complete strategic review as JSON matching the specified schema.
Be specific and actionable — generic advice is not useful. Reference the institution's
actual themes and projects when giving strategy recommendations."""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="deep_reviewer",
        json_mode=True,
    )
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {
            "fit_score": 0,
            "priority": "low_fit",
            "verdict": "Review failed — could not parse response",
            "score_breakdown": {},
            "strengths": [],
            "risks": ["AI response could not be parsed"],
            "proposal_strategy": "",
            "critical_requirements": [],
            "archive_references": [],
            "go_no_go": "NO-GO",
            "go_no_go_rationale": "Review failed.",
            "recommended_sections": [],
            "error": response,
        }
