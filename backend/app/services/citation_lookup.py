"""OpenAlex + PubMed citation lookup with in-memory cache."""
from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.config import get_settings

_cache: dict[str, tuple[float, list[dict]]] = {}


def _cache_get(key: str, ttl_hours: int) -> list[dict] | None:
    entry = _cache.get(key)
    if not entry:
        return None
    ts, results = entry
    if time.time() - ts > ttl_hours * 3600:
        del _cache[key]
        return None
    return results


def _cache_set(key: str, results: list[dict]) -> None:
    _cache[key] = (time.time(), results)


async def search_openalex(query: str, max_results: int = 5) -> list[dict]:
    cfg = get_settings().citations
    url = f"{cfg.openalex_base_url.rstrip('/')}/works"
    params = {"search": query, "per_page": max_results, "mailto": cfg.pubmed_email}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    results = []
    for work in data.get("results", []):
        authors = work.get("authorships", [])
        author_names = []
        for a in authors[:3]:
            name = (a.get("author") or {}).get("display_name")
            if name:
                author_names.append(name)
        doi = work.get("doi") or ""
        results.append({
            "source_type": "openalex",
            "external_id": work.get("id", ""),
            "title": work.get("title") or work.get("display_name") or "",
            "authors": author_names,
            "year": (work.get("publication_year") or ""),
            "doi": doi.replace("https://doi.org/", "") if doi else "",
            "url": doi or work.get("id", ""),
            "abstract": (work.get("abstract_inverted_index") and "Abstract available") or "",
            "formatted_citation": _format_citation(
                author_names, work.get("publication_year"), work.get("title"), doi
            ),
        })
    return results


async def search_pubmed(query: str, max_results: int = 5) -> list[dict]:
    cfg = get_settings().citations
    email = cfg.pubmed_email
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    async with httpx.AsyncClient(timeout=20) as client:
        search_resp = await client.get(
            f"{base}/esearch.fcgi",
            params={"db": "pubmed", "term": query, "retmax": max_results, "retmode": "json", "email": email},
        )
        search_resp.raise_for_status()
        ids = search_resp.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return []
        summary_resp = await client.get(
            f"{base}/esummary.fcgi",
            params={"db": "pubmed", "id": ",".join(ids), "retmode": "json", "email": email},
        )
        summary_resp.raise_for_status()
        summary_data = summary_resp.json().get("result", {})

    results = []
    for pmid in ids:
        item = summary_data.get(pmid, {})
        if not isinstance(item, dict) or pmid == "uids":
            continue
        authors = item.get("authors", [])
        author_names = [a.get("name", "") for a in authors[:3] if a.get("name")]
        title = item.get("title", "")
        year = (item.get("pubdate") or "")[:4]
        doi = item.get("elocationid", "").replace("doi: ", "") if "doi" in (item.get("elocationid") or "") else ""
        results.append({
            "source_type": "pubmed",
            "external_id": pmid,
            "title": title,
            "authors": author_names,
            "year": year,
            "doi": doi,
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            "abstract": "",
            "formatted_citation": _format_citation(author_names, year, title, doi or f"PMID:{pmid}"),
        })
    return results


def _format_citation(authors: list[str], year: Any, title: str, identifier: str) -> str:
    author_str = ", ".join(authors[:3])
    if len(authors) > 3:
        author_str += " et al."
    parts = [p for p in [author_str, f"({year})" if year else "", title, identifier] if p]
    return ". ".join(parts) + "."


async def search_citations(query: str, max_results: int | None = None) -> list[dict]:
    cfg = get_settings().citations
    limit = max_results or cfg.max_results_per_query
    cache_key = f"{query}:{limit}"
    cached = _cache_get(cache_key, cfg.cache_ttl_hours)
    if cached is not None:
        return cached

    openalex_task = search_openalex(query, limit)
    pubmed_task = search_pubmed(query, limit)
    openalex_results, pubmed_results = await asyncio.gather(openalex_task, pubmed_task, return_exceptions=True)

    combined: list[dict] = []
    if isinstance(openalex_results, list):
        combined.extend(openalex_results)
    if isinstance(pubmed_results, list):
        combined.extend(pubmed_results)

    # Deduplicate by title similarity (simple lowercase match)
    seen_titles: set[str] = set()
    deduped = []
    for r in combined:
        key = (r.get("title") or "").lower()[:80]
        if key and key not in seen_titles:
            seen_titles.add(key)
            deduped.append(r)
    deduped = deduped[:limit]
    _cache_set(cache_key, deduped)
    return deduped
