"""Citation Agent — find and format citations for grant claims.

Uses three search arms in parallel:
  1. OpenAlex/PubMed — peer-reviewed academic literature
  2. Exa.ai neural search — grey literature, policy reports, programme evaluations,
     funder reports, and recent evidence not indexed in academic databases
  3. Exa find_similar — surface related sources from strong matches

Exa queries are phrased as natural-language sentences matching document language
(not keywords), per Exa neural search best practices.
"""
import asyncio
import json
from app.ai.client import chat_complete
from app.services.citation_lookup import search_citations

SYSTEM_PROMPT = """You are a research librarian helping grant writers find citations.
Select the most relevant sources from BOTH academic databases AND neural web search results.
Format them appropriately for grant proposal use.
Prefer academic sources for empirical claims; prefer Exa results for policy context,
grey literature, funder reports, and programme evaluations.
Respond with valid JSON."""


def _claim_to_exa_query(claim: str) -> str:
    """
    Convert a grant claim into an Exa-optimized natural language query.
    Exa neural search works best when the query reads like text that
    would appear IN the target document, not a user's question about it.
    """
    claim = claim.strip().rstrip(".")
    # If it already reads like a statement, use it directly with a source-framing prefix
    if len(claim) > 40:
        return f"{claim} evidence from studies and programme evaluations"
    # Short claims: wrap in a document-like sentence
    return f"research and programme evidence demonstrating {claim}"


async def _exa_search_for_claim(claim: str, max_results: int = 4) -> list[dict]:
    """Run Exa neural search for a single claim, return normalised result dicts."""
    try:
        from app.services.exa_search import exa_search
        query = _claim_to_exa_query(claim)
        results = await exa_search(query, num_results=max_results, search_type="auto")
        return [{"title": r.get("title", ""), "url": r.get("url", ""),
                 "excerpt": r.get("content", ""), "source_type": "exa"} for r in results]
    except Exception:
        return []


async def find_citations_for_claims(
    claims: list[str],
    section_context: str = "",
    max_per_claim: int = 3,
) -> dict:
    """
    Find and format citations for a list of grant claims.

    Runs academic search (OpenAlex/PubMed) and Exa neural search in parallel
    for each claim, then asks an LLM to select and format the best citations.
    """
    active_claims = claims[:5]

    # Build parallel tasks for each claim: academic + exa in parallel
    async def _search_claim(claim: str) -> dict:
        academic_task = search_citations(claim, max_results=max_per_claim)
        exa_task = _exa_search_for_claim(claim, max_results=max_per_claim)
        academic, exa = await asyncio.gather(academic_task, exa_task, return_exceptions=True)
        return {
            "claim": claim,
            "academic_sources": academic if isinstance(academic, list) else [],
            "exa_sources": exa if isinstance(exa, list) else [],
        }

    all_results = await asyncio.gather(*[_search_claim(c) for c in active_claims])

    user_prompt = f"""Select and format the best citations for these grant claims.
Use BOTH academic sources and Exa neural search sources. Prefer academic for empirical
statistics; prefer Exa for policy context, grey literature, and programme evidence.

SECTION CONTEXT:
{section_context[:2000]}

SEARCH RESULTS (academic + Exa neural search per claim):
{json.dumps(list(all_results), indent=2)[:8000]}

Return JSON with:
- citations: list of {{claim, formatted_citation, source_type ("academic"|"exa"|"web"), external_id, url, relevance_note}}
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
        result["raw_search_results"] = list(all_results)
        return result
    except json.JSONDecodeError:
        return {"citations": [], "raw_search_results": list(all_results), "error": "Citation agent failed"}
