"""
Opportunity Summarizer — translates, reformats, and summarises a grant opportunity.

For every opportunity the pipeline produces two English-language outputs:

  short_description  — 2–3 sentence card teaser (plain prose, no markdown)
  full_summary       — rich markdown document with ## sections for deep reading

Both are returned as a JSON object so a single LLM call handles translation +
formatting in one shot, regardless of the original source language.
"""
import json
import structlog
from app.ai.client import chat_complete
from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()

_SYSTEM_PROMPT = """\
You are a grant intelligence analyst for the LiGHT (Learning & Intelligent Health Technologies) \
research group at EPFL (École Polytechnique Fédérale de Lausanne).

IMPORTANT RULES:
1. ALL output must be in clear, fluent English — translate any non-English source text first.
2. Return ONLY a valid JSON object with exactly two keys: "short_description" and "full_summary".
3. Do not wrap the JSON in markdown code fences or add any text outside the JSON.

The LiGHT team focuses on:
- AI for health, clinical AI, foundation models, federated learning, edge AI
- Global health / LMIC: tuberculosis, maternal health, newborn health, POCUS/ultrasound
- Responsible AI, open-source AI, implementation science
- Partnerships across sub-Saharan Africa, South Asia, Southeast Asia
- Institution: EPFL (academic, Switzerland, EU)

short_description format:
  2–3 sentences of plain prose (no markdown, no bullets). Clearly state what the grant funds,
  who is eligible, and the award size / deadline if known. Written for a researcher scanning
  a card who needs to decide in 5 seconds whether to click through.

full_summary format:
  Rich markdown document using ## headers. Use **bold** for key terms, bullet lists for
  eligibility / dates / action items, and normal paragraphs for explanatory sections.
  Be concrete and actionable — tell the team exactly what to do."""


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
    summary_tier: str = "full",
) -> dict:
    """
    Translate, reformat, and summarise a grant opportunity.

    Returns a dict with:
      "short_description" — plain-prose English card teaser (2–3 sentences)
      "full_summary"      — rich markdown document (## sections, bold, bullets)
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

    header = f"""Translate (if needed) and reformat this grant opportunity for the LiGHT team.
Return a JSON object with "short_description" and "full_summary".

─── SOURCE DETAILS ───────────────────────────────────────
Title:          {title}
Funder:         {funder}
Award:          {award_range}
Deadline:       {deadline or "Not specified"}
LOI Deadline:   {loi_deadline or "N/A"}
Geography:      {geography or "Not specified"}
Themes:         {themes_str}
Fit Score:      {f"{fit_score:.0f}/100" if fit_score else "Not scored yet"}
URL:            {opportunity_url or "N/A"}

DESCRIPTION (may be in any language — translate to English):
{description or "No description available."}

ELIGIBILITY (may be in any language — translate to English):
{eligibility or "Not specified."}

FIT RATIONALE: {fit_rationale or "None."}

TEAM PROFILE:
- Core themes: {team_themes}
- Target geographies: {team_geos}
- Institution: EPFL (academic, Switzerland, EU member)
──────────────────────────────────────────────────────────

"short_description": 2–3 sentences of plain English prose for the opportunity card.
  State what the grant funds, who qualifies, and the award/deadline. No markdown.
"""

    # Brief tier: only the 5 most decision-critical sections (medium fit 25–54).
    # Full tier: all 8 sections including project ideas and action items (fit ≥ 55).
    if summary_tier == "brief":
        sections_prompt = """"full_summary": Markdown document with EXACTLY these ## sections:

## What This Grant Funds
2–3 paragraphs: funder's goal, problem they want to solve, types of projects supported.

## Eligibility at a Glance
Bullet list of ALL eligibility requirements. Use ⚠️ to flag any LiGHT may not meet.

## Key Dates
Bullet list of all deadlines (full proposal, LOI, concept note, Q&A window).

## Fit for LiGHT / EPFL
3–4 sentences on why (or why not) this is a strong fit for the team.

## Budget & Award Details
Award size, duration, number of awards, indirect cost rules."""
    else:
        sections_prompt = """"full_summary": Full markdown document with EXACTLY these ## sections:

## What This Grant Funds
2–3 paragraphs: funder's goal, problem they want to solve, types of projects supported,
what a successful grantee looks like.

## Eligibility at a Glance
Bullet list of ALL eligibility requirements. Use ⚠️ to flag any LiGHT may not meet.
Include institution type, nationality, prior funding restrictions, co-PI rules.

## Key Dates
Bullet list of all deadlines (full proposal, LOI, concept note, Q&A window).

## Fit for LiGHT / EPFL
3–4 sentences on why (or why not) this is a strong fit. Reference specific LiGHT
research areas. Be honest about gaps or risks.

## Potential Projects to Propose
4–6 concrete project ideas LiGHT could submit, each 2–3 sentences. Align each to
the funder's stated priorities with rough methodology.

## Partnership Opportunities
Which external partners, institutions, or NGOs would strengthen a LiGHT proposal?

## Budget & Award Details
Award size, duration, number of awards, indirect cost rules, sub-award eligibility.

## Risk Flags
Bullet list: competition level, eligibility uncertainty, scope mismatches, capacity concerns.

## Action Items
Numbered list of concrete next steps: contacts, documents to prepare, go/no-go timeline."""

    user_prompt = header + sections_prompt

    try:
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="opportunity_summarizer",
        )
        # Strip markdown fences if the model wraps the JSON
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.rsplit("```", 1)[0].strip()

        result = json.loads(cleaned)
        return {
            "short_description": result.get("short_description", "").strip(),
            "full_summary": result.get("full_summary", "").strip(),
        }
    except json.JSONDecodeError:
        # Fallback: treat the whole response as the full summary
        logger.warning("Opportunity summarizer returned non-JSON, using as full_summary", title=title)
        return {
            "short_description": "",
            "full_summary": raw.strip() if raw else f"## Summary Unavailable\n\nFailed to parse AI response.",
        }
    except Exception as e:
        logger.error("Opportunity summarizer failed", title=title, error=str(e))
        return {
            "short_description": "",
            "full_summary": f"## Summary Unavailable\n\nFailed to generate AI summary: {e}",
        }
