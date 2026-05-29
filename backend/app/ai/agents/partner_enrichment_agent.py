"""
Partner Enrichment Agent — enriches partner profiles using Tavily web search
and OpenAlex publications API to gather h-index, expertise, and recent publications.
"""
import json
from typing import Optional

from app.ai.client import chat_complete
from app.services.web_search import search_web


SYSTEM_PROMPT = """You are a researcher profile enrichment assistant.
Given information about an academic or industry researcher, extract and structure
their key expertise areas, research domains, and professional background.
Respond only with valid JSON."""


async def enrich_partner_profile(
    name: str,
    organization: Optional[str] = None,
    email: Optional[str] = None,
    orcid: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    title: Optional[str] = None,
) -> dict:
    """
    Enrich a partner profile using web search and OpenAlex.

    Returns a dict with:
      - h_index: int | None
      - expertise_tags: list[str]
      - recent_publications: list[{title, year, doi}]
      - bio_snippet: str
      - enrichment_source: str
    """
    web_context = ""
    publications = []
    h_index = None

    # 1. OpenAlex lookup by ORCID or name+org
    try:
        openalex_data = await _search_openalex_author(name, orcid, organization)
        if openalex_data:
            h_index = openalex_data.get("h_index")
            publications = openalex_data.get("publications", [])
            web_context += f"\nOpenAlex profile: {openalex_data.get('summary', '')}"
    except Exception:
        pass

    # 2. Tavily web search for additional context
    try:
        search_query = f'{name} researcher {organization or ""} {title or ""} expertise publications'.strip()
        results = await search_web(search_query, max_results=5, search_depth="basic")
        if results:
            snippets = "\n".join(r.get("content", "")[:400] for r in results[:3])
            web_context += f"\n\nWeb search results:\n{snippets}"
    except Exception:
        pass

    if not web_context.strip():
        return {
            "h_index": None,
            "expertise_tags": [],
            "recent_publications": [],
            "bio_snippet": "",
            "enrichment_source": "none",
        }

    # 3. LLM extraction
    user_prompt = f"""Researcher: {name}
Title: {title or 'N/A'}
Organization: {organization or 'N/A'}
ORCID: {orcid or 'N/A'}

Context gathered:
{web_context[:4000]}

Publications found: {json.dumps(publications[:5], default=str)}

Extract and return JSON:
{{
  "expertise_tags": ["tag1", "tag2", ...],  // 5-10 research area tags, concise
  "bio_snippet": "...",  // 1-2 sentence summary of their research focus
  "key_research_areas": ["area1", "area2", ...]  // broader domains (3-5 items)
}}"""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            agent_name="partner_enrichment",
            json_mode=True,
        )
        result = json.loads(response)
    except Exception:
        result = {}

    return {
        "h_index": h_index,
        "expertise_tags": result.get("expertise_tags", [])[:10],
        "recent_publications": publications[:5],
        "bio_snippet": result.get("bio_snippet", ""),
        "enrichment_source": "openalex+tavily" if h_index else "tavily",
    }


async def _search_openalex_author(
    name: str,
    orcid: Optional[str] = None,
    organization: Optional[str] = None,
) -> dict | None:
    """Query OpenAlex for an author's h-index and recent publications."""
    import httpx
    from app.config import get_settings

    settings = get_settings()
    base_url = settings.citations.openalex_base_url.rstrip("/")
    email = settings.citations.pubmed_email

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if orcid:
                orcid_clean = orcid.replace("https://orcid.org/", "")
                url = f"{base_url}/authors/https://orcid.org/{orcid_clean}"
                resp = await client.get(url, params={"mailto": email})
            else:
                query = f"{name}"
                if organization:
                    query += f" {organization}"
                resp = await client.get(
                    f"{base_url}/authors",
                    params={"search": query, "per_page": 3, "mailto": email},
                )

            if resp.status_code != 200:
                return None
            data = resp.json()

            # Handle search results vs direct lookup
            if "results" in data:
                items = data["results"]
                if not items:
                    return None
                author = items[0]
            else:
                author = data

            h_index = author.get("summary_stats", {}).get("h_index")
            author_id = author.get("id", "")

            # Fetch recent works
            pubs = []
            if author_id:
                works_resp = await client.get(
                    f"{base_url}/works",
                    params={
                        "filter": f"authorships.author.id:{author_id}",
                        "sort": "publication_year:desc",
                        "per_page": 5,
                        "mailto": email,
                    },
                )
                if works_resp.status_code == 200:
                    for w in works_resp.json().get("results", []):
                        doi = w.get("doi", "")
                        pubs.append({
                            "title": w.get("title", ""),
                            "year": w.get("publication_year"),
                            "doi": doi.replace("https://doi.org/", "") if doi else "",
                        })

            display_name = author.get("display_name", name)
            affiliations = author.get("affiliations", [])
            aff_str = ", ".join(a.get("institution", {}).get("display_name", "") for a in affiliations[:2] if a.get("institution"))

            return {
                "h_index": h_index,
                "publications": pubs,
                "summary": f"{display_name} — {aff_str}" if aff_str else display_name,
            }
    except Exception:
        return None


async def extract_expertise_from_text(text: str) -> list[dict]:
    """
    Extract structured expertise areas from a CV or bio document.

    Returns list of {area: str, confidence: float, keywords: list[str]}
    """
    prompt = f"""Extract research expertise areas from this CV/bio text.

TEXT:
{text[:6000]}

Return JSON array:
[
  {{"area": "Machine Learning", "confidence": 0.95, "keywords": ["neural networks", "deep learning"]}},
  ...
]

Extract 5-10 distinct expertise areas. Be specific and academic."""

    try:
        response = await chat_complete(
            messages=[
                {"role": "system", "content": "You extract research expertise from academic CVs. Respond with JSON only."},
                {"role": "user", "content": prompt},
            ],
            agent_name="partner_enrichment",
            json_mode=True,
        )
        result = json.loads(response)
        if isinstance(result, list):
            return result[:10]
        return []
    except Exception:
        return []
