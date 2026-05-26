"""Citation Agent — find and format citations for grant claims."""
import json
from app.ai.client import chat_complete
from app.services.citation_lookup import search_citations

SYSTEM_PROMPT = """You are a research librarian helping grant writers find citations.
Select the most relevant sources and format them for grant proposal use.
Respond with valid JSON."""


async def find_citations_for_claims(
    claims: list[str],
    section_context: str = "",
    max_per_claim: int = 3,
) -> dict:
    all_results = []
    for claim in claims[:5]:
        try:
            results = await search_citations(claim, max_results=max_per_claim)
            all_results.append({"claim": claim, "sources": results})
        except Exception as e:
            all_results.append({"claim": claim, "sources": [], "error": str(e)})

    user_prompt = f"""Select and format the best citations for these grant claims.

SECTION CONTEXT:
{section_context[:2000]}

SEARCH RESULTS:
{json.dumps(all_results, indent=2)[:8000]}

Return JSON with:
- citations: list of {{claim, formatted_citation, source_type, external_id, url, relevance_note}}
- unsupported_claims: list of claims needing manual verification
- suggested_stats: list of statistics that could strengthen the section with search queries
"""

    response = await chat_complete(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        agent_name="citation_agent",
        json_mode=True,
    )
    try:
        result = json.loads(response)
        result["raw_search_results"] = all_results
        return result
    except json.JSONDecodeError:
        return {"citations": [], "raw_search_results": all_results, "error": "Citation agent failed"}
