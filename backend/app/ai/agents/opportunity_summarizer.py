"""
Opportunity Summarizer — generates a structured markdown AI summary for a grant opportunity.

The summary is specifically tailored for the LiGHT research group at EPFL, explaining:
- What the grant funds
- Eligibility requirements in plain language
- Key dates
- How LiGHT could apply and what projects to propose
- Budget and award details
- Immediate action items

Output is stored in Opportunity.ai_summary as markdown for rich rendering in the frontend.
"""
import json
import structlog
from app.ai.client import chat_complete
from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()

_SYSTEM_PROMPT = """\
You are a grant intelligence analyst for the LiGHT (Learning & Intelligent Health Technologies) \
research group at EPFL (École Polytechnique Fédérale de Lausanne). Your role is to write \
clear, actionable grant opportunity summaries for the team.

The LiGHT team focuses on:
- AI for health, clinical AI, foundation models, federated learning, edge AI
- Global health / LMIC: tuberculosis, maternal health, newborn health, POCUS/ultrasound
- Responsible AI, open-source AI, implementation science
- Partnerships across sub-Saharan Africa, South Asia, Southeast Asia
- Institution: EPFL (academic, Switzerland, EU)

Write summaries in structured markdown. Be concrete and practical — tell the team \
exactly what to do, what projects fit, and flag any eligibility concerns. \
Be direct, not verbose."""


async def generate_opportunity_summary(
    title: str,
    funder: str,
    description: str,
    eligibility: str = "",
    geography: str = "",
    award_min: float | None = None,
    award_max: float | None = None,
    currency: str = "USD",
    deadline: str = "",
    loi_deadline: str = "",
    thematic_areas: list[str] | None = None,
    opportunity_url: str = "",
    fit_score: float | None = None,
    fit_rationale: str = "",
) -> str:
    """
    Generate a structured markdown AI summary for a grant opportunity.

    Returns a markdown string with sections covering funding scope, eligibility,
    key dates, LiGHT fit, proposed projects, and action items.
    """
    scoring = settings.fit_scoring
    team_themes = ", ".join(scoring.team_themes[:15])
    team_geos = ", ".join(scoring.team_geographies)

    award_range = ""
    if award_min and award_max:
        award_range = f"{currency} {award_min:,.0f} – {award_max:,.0f}"
    elif award_max:
        award_range = f"Up to {currency} {award_max:,.0f}"
    elif award_min:
        award_range = f"From {currency} {award_min:,.0f}"
    else:
        award_range = "Not specified"

    themes_str = ", ".join(thematic_areas) if thematic_areas else "Not specified"

    user_prompt = f"""Generate a structured grant opportunity summary for the LiGHT team.

GRANT DETAILS:
Title: {title}
Funder: {funder}
Award: {award_range}
Deadline: {deadline or "Not specified"}
LOI Deadline: {loi_deadline or "N/A"}
Geography: {geography or "Not specified"}
Thematic Areas: {themes_str}
Fit Score: {f"{fit_score:.0f}/100" if fit_score else "Not scored yet"}
URL: {opportunity_url or "N/A"}

DESCRIPTION:
{description[:4000] if description else "No description available."}

ELIGIBILITY:
{eligibility[:1000] if eligibility else "Not specified."}

EXISTING FIT RATIONALE:
{fit_rationale[:500] if fit_rationale else "None."}

TEAM PROFILE:
- Core themes: {team_themes}
- Target geographies: {team_geos}
- Institution: EPFL (academic, Switzerland, EU member)

Generate a markdown summary using EXACTLY these sections (use ## for each header):

## What This Grant Funds
One clear paragraph explaining the funder's goals and what they will pay for.

## Eligibility at a Glance
Bullet list of key eligibility requirements. Flag any that LiGHT may not meet with ⚠️.

## Key Dates
Bullet list: deadline(s), LOI dates, any other milestones.

## Fit for LiGHT / EPFL
2–3 sentences explaining why (or why not) this is a strong fit. Reference specific LiGHT projects or capabilities.

## Potential Projects to Propose
Bullet list of 3–5 concrete project ideas LiGHT could submit, aligned to the funder's priorities. Be specific.

## Budget & Award Details
Clear statement of award size, duration, number of expected awards, cost-sharing requirements if known.

## Action Items
Numbered list of immediate next steps the team should take."""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="opportunity_summarizer",
            temperature=0.3,
            max_tokens=2000,
        )
        # Response is already markdown — return as-is
        return response.strip()
    except Exception as e:
        logger.error("Opportunity summarizer failed", title=title, error=str(e))
        return f"## Summary Unavailable\n\nFailed to generate AI summary: {e}"
