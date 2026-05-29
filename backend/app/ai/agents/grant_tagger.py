"""
Universal Grant Tagger — classifies any grant with a broad, reusable tag taxonomy.

Uses gpt-4o-mini (via agent_name="grant_tagger") to stamp every scraped grant
with tags across five dimensions so that non-org-specific searches can surface
relevant grants to any user:

  topics      — subject-matter domains (healthcare, education, environment, …)
  geography   — geographic scope (United States, EU, Africa, global, …)
  populations — target beneficiary groups (children, elderly, veterans, …)
  mechanism   — funding mechanism / applicant type (research, small business, …)
  technology  — specific technology areas (AI, nuclear, biotech, clean energy, …)

All five lists are merged into Opportunity.thematic_areas and Opportunity.keywords
so existing ILIKE + tag containment filters work immediately.
"""
import json
import structlog
from app.ai.client import chat_complete

logger = structlog.get_logger()

_SYSTEM_PROMPT = """\
You are a grant classification engine. Your sole job is to tag a grant opportunity
with a comprehensive set of standardised labels across five dimensions.

IMPORTANT RULES:
1. Return ONLY a valid JSON object — no prose, no markdown fences.
2. Every value must be a flat list of strings (no nested objects).
3. Be thorough: include every tag that legitimately applies. Missing tags is worse
   than a few extra tags.
4. Use plain English labels (not codes): e.g. "United States", not "US" or "USA".
5. If a dimension is genuinely not applicable, return an empty list [].

Dimension definitions:

  "topics": The subject-matter domains the grant addresses.
    Examples: healthcare, education, environment, agriculture, housing, arts,
    STEM, community development, workforce development, mental health,
    food security, water sanitation, climate change, disaster relief,
    economic development, human rights, gender equality, public safety,
    transportation, energy, media & journalism, legal aid, animal welfare

  "geography": The geographic scope of eligible applicants or funded work.
    Examples: United States, European Union, United Kingdom, Africa,
    sub-Saharan Africa, South Asia, Southeast Asia, Latin America,
    Middle East, global, low-income countries, OECD countries, specific
    country names if mentioned (e.g. Kenya, India)

  "populations": The beneficiary populations the grant targets.
    Examples: children, youth, elderly, women, veterans, indigenous peoples,
    rural communities, urban communities, immigrants, refugees, people with
    disabilities, LGBTQ+, low-income households, minorities, entrepreneurs,
    students, researchers, nonprofits, small businesses

  "mechanism": What kind of entity can apply or what type of funding it is.
    Examples: research grant, small business, nonprofit, university/academic,
    government agency, individual fellowship, cooperative agreement,
    contract, loan, prize/competition, public-private partnership, SBIR,
    STTR, R01, R21, foundation grant

  "technology": Specific technology or scientific areas (only include if relevant).
    Examples: artificial intelligence, machine learning, nuclear energy,
    biotechnology, clean energy, renewable energy, cybersecurity, genomics,
    nanotechnology, advanced manufacturing, quantum computing, space,
    medical devices, pharmaceuticals, robotics, blockchain, telecommunications
"""


async def tag_grant(
    title: str,
    funder: str,
    description: str,
    eligibility: str = "",
    geography: str = "",
) -> dict:
    """
    Classify a grant and return structured tags.

    Returns a dict with keys:
      "topics", "geography", "populations", "mechanism", "technology"
    Each value is a list of strings. Returns empty lists on failure.
    """
    # Cap description to control token cost — 2000 chars covers all meaningful content
    desc_text = (description or "")[:2000]
    elig_text = (eligibility or "")[:500]
    geo_text = (geography or "")[:200]

    user_prompt = f"""\
Classify this grant opportunity and return a JSON object with keys:
"topics", "geography", "populations", "mechanism", "technology"

Title:       {title}
Funder:      {funder or "Unknown"}
Geography:   {geo_text or "Not specified"}
Eligibility: {elig_text or "Not specified"}

Description:
{desc_text or "No description available."}
"""

    empty = {"topics": [], "geography": [], "populations": [], "mechanism": [], "technology": []}

    try:
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="grant_tagger",
            json_mode=True,
        )

        cleaned = raw.strip()
        # Strip any accidental markdown fences
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.rsplit("```", 1)[0].strip()

        result = json.loads(cleaned)

        # Normalise: ensure each key is a list of strings, drop empties
        tags: dict[str, list[str]] = {}
        for key in ("topics", "geography", "populations", "mechanism", "technology"):
            raw_list = result.get(key, [])
            if isinstance(raw_list, list):
                tags[key] = [str(t).strip() for t in raw_list if t and str(t).strip()]
            else:
                tags[key] = []

        logger.info(
            "Grant tagged",
            title=title,
            topics=len(tags["topics"]),
            geography=len(tags["geography"]),
            populations=len(tags["populations"]),
            mechanism=len(tags["mechanism"]),
            technology=len(tags["technology"]),
        )
        return tags

    except json.JSONDecodeError as e:
        logger.warning("Grant tagger returned non-JSON", title=title, error=str(e), raw=raw[:200] if raw else "")
        return empty
    except Exception as e:
        logger.error("Grant tagger failed", title=title, error=str(e))
        return empty


def merge_tags_into_opportunity(opp, tags: dict) -> bool:
    """
    Write tagger output into Opportunity fields. Returns True if anything changed.

    Merges into thematic_areas (topics + populations + mechanism + technology)
    and keywords (all tags flat), and updates geography only when currently empty.
    """
    existing_thematic = set(opp.thematic_areas or [])
    existing_keywords = set(opp.keywords or [])
    existing_geography = list(opp.geography or [])

    # thematic_areas gets the rich topic/population/mechanism/technology labels
    new_thematic = (
        tags.get("topics", [])
        + tags.get("populations", [])
        + tags.get("mechanism", [])
        + tags.get("technology", [])
    )
    merged_thematic = list(existing_thematic | set(new_thematic))

    # keywords gets a flat deduplicated list of every tag across all dimensions
    all_new_tags = []
    for v in tags.values():
        all_new_tags.extend(v)
    merged_keywords = list(existing_keywords | set(all_new_tags))

    # Geography: only update when currently empty or very sparse
    new_geography = tags.get("geography", [])
    if not existing_geography and new_geography:
        merged_geography = new_geography
    else:
        merged_geography = list(set(existing_geography) | set(new_geography))

    changed = (
        set(merged_thematic) != existing_thematic
        or set(merged_keywords) != existing_keywords
        or set(merged_geography) != set(existing_geography)
    )

    if changed:
        opp.thematic_areas = sorted(merged_thematic)
        opp.keywords = sorted(merged_keywords)
        opp.geography = sorted(merged_geography)

    return changed
