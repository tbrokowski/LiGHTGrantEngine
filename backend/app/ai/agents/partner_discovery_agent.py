"""
Partner Discovery Agent — finds potential new research partners using
Tavily web search and OpenAlex by research area and expertise keywords.
"""
import json
from typing import Optional

from app.ai.client import chat_complete
from app.services.web_search import search_web_multi


SYSTEM_PROMPT = """You are a research collaboration scout. Extract structured partner profiles
from web search results. Focus on researchers, academics, and professionals.
Respond only with valid JSON."""


async def discover_partners(
    query: str,
    institution_type: Optional[str] = None,
    country: Optional[str] = None,
    max_results: int = 10,
) -> dict:
    """
    Discover potential new research partners via web search.

    Returns:
        {candidates: [{name, title, organization, expertise, url, source}], query_used: str}
    """
    # Build targeted queries
    queries = [f"{query} researcher"]
    if institution_type:
        queries.append(f"{query} {institution_type} researcher")
    if country:
        queries.append(f"{query} researcher {country}")

    # Also search OpenAlex
    openalex_results = await _search_openalex_experts(query, max_results=5)

    # Tavily web search
    web_results = await search_web_multi(
        queries,
        max_results_per_query=5,
        search_depth="basic",
    )

    if not web_results and not openalex_results:
        return {"candidates": [], "query_used": query, "source": "none"}

    # Build context for LLM extraction
    web_snippets = "\n".join(
        f"- {r.get('title', '')}: {r.get('content', '')[:300]} (URL: {r.get('url', '')})"
        for r in web_results[:8]
    )

    openalex_snippets = "\n".join(
        f"- {p.get('display_name', '')}, {p.get('last_known_institution', '')}, h-index: {p.get('h_index', '?')}, works: {p.get('works_count', '?')}"
        for p in openalex_results
    )

    context = ""
    if openalex_snippets:
        context += f"Academic database results:\n{openalex_snippets}\n\n"
    if web_snippets:
        context += f"Web search results:\n{web_snippets}"

    user_prompt = f"""Search query: "{query}"
{f'Institution type filter: {institution_type}' if institution_type else ''}
{f'Country filter: {country}' if country else ''}

Found content:
{context[:5000]}

Extract up to {max_results} distinct potential research partner profiles.
For each person found, extract:

Return JSON:
{{
  "candidates": [
    {{
      "name": "Full Name",
      "title": "Professor / Dr / etc.",
      "organization": "University/Company name",
      "department": "Department if known",
      "country": "Country if known",
      "expertise": ["tag1", "tag2"],
      "h_index": null or number,
      "url": "profile URL if found",
      "source": "openalex" | "web",
      "confidence": 0.9
    }}
  ]
}}

Only include real people with clear research relevance to: {query}
Do not invent people — only extract those explicitly mentioned in the content."""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="partner_discovery",
            json_mode=True,
        )
        result = json.loads(response)
        candidates = result.get("candidates", [])
        # Sort by confidence
        candidates.sort(key=lambda x: x.get("confidence", 0), reverse=True)
        return {
            "candidates": candidates[:max_results],
            "query_used": query,
            "total_found": len(candidates),
        }
    except Exception as e:
        return {"candidates": [], "query_used": query, "error": str(e)}


async def _search_openalex_experts(query: str, max_results: int = 5) -> list[dict]:
    """Search OpenAlex for experts in a research domain."""
    import httpx
    from app.config import get_settings

    settings = get_settings()
    base_url = settings.citations.openalex_base_url.rstrip("/")
    email = settings.citations.pubmed_email

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/authors",
                params={
                    "search": query,
                    "per_page": max_results,
                    "sort": "cited_by_count:desc",
                    "mailto": email,
                },
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            results = []
            for a in data.get("results", []):
                inst = a.get("last_known_institutions", [{}])
                inst_name = inst[0].get("display_name", "") if inst else ""
                results.append({
                    "display_name": a.get("display_name", ""),
                    "last_known_institution": inst_name,
                    "h_index": a.get("summary_stats", {}).get("h_index"),
                    "works_count": a.get("works_count", 0),
                    "orcid": a.get("orcid", ""),
                })
            return results
    except Exception:
        return []
