"""Tier-2 agentic discovery — the fallback when the normal scrape finds nothing.

Some funders bury their opportunities behind navigation the flat crawler misses
(e.g. ASHG's fellowships live at /careers-learning/fellowships/, not linked from
the seed page). This module does what a person would: web-search the funder,
guess the common funding sub-paths on its own site, fetch the best candidate
pages, and LLM-extract opportunities from them.

Bounded on purpose (only runs on a zero-result scrape): a handful of search
queries + a capped number of page fetches/LLM extractions.
"""
from __future__ import annotations

import asyncio
import structlog
from urllib.parse import urljoin, urlparse

logger = structlog.get_logger()

# Sub-paths funders commonly host funding/fellowship listings under. Tried on the
# source's own domain in addition to whatever web search surfaces.
_FUNDING_SUBPATHS = (
    "/funding", "/grants", "/fellowships", "/fellowship", "/awards", "/scholarships",
    "/opportunities", "/apply", "/funding-opportunities", "/grants-funding",
    "/careers-learning/fellowships", "/research/funding", "/what-we-do/grants",
)
_FUNDING_HINTS = (
    "fellowship", "grant", "funding", "award", "scholarship", "call", "apply",
    "bursary", "prize", "opportunit", "research",
)


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "").lower()
    except Exception:
        return ""


async def agentic_discover(
    source_name: str,
    source_url: str,
    *,
    use_playwright: bool = True,
    max_pages: int = 8,
    max_results: int = 25,
) -> list[dict]:
    """Return raw opportunity dicts discovered via web search + site navigation.

    Dicts are in the same shape AIScraper's LLM extractor produces (title, url,
    funder, description, deadline, opportunity_type) so the caller can run them
    through its normal `_normalize`.
    """
    from app.services.web_search import search_web_multi
    from app.scrapers.ai_scraper import _fetch_page_text, _llm_extract, _is_document_url

    domain = _domain(source_url)
    src_norm = (source_url or "").rstrip("/")

    # 1. Web search — the "search it in Google" step.
    queries = [
        f"{source_name} fellowship OR grant OR funding opportunity apply",
        f"{source_name} call for applications deadline",
    ]
    if domain:
        queries.append(f"{source_name} funding site:{domain}")
    web_hits: list[dict] = []
    try:
        web_hits = await search_web_multi(queries, max_results_per_query=5)
    except Exception as exc:
        logger.warning("agentic_discover: web search failed", error=str(exc))

    candidates: list[str] = [h.get("url", "") for h in web_hits if h.get("url")]

    # 2. Guess the funder's own funding sub-pages.
    if source_url:
        candidates.extend(urljoin(source_url + "/", sp.lstrip("/")) for sp in _FUNDING_SUBPATHS)

    # 3. Rank + dedupe: same-domain and funding-keyword URLs first; drop the bare
    #    seed URL (Tier-1 already extracted nothing from it).
    seen: set[str] = set()
    ranked: list[str] = []
    for u in candidates:
        nu = u.rstrip("/")
        if not nu or nu == src_norm or nu in seen:
            continue
        seen.add(nu)
        ranked.append(u)

    def _rank(u: str) -> int:
        ul = u.lower()
        score = 0
        if domain and domain in ul:
            score += 2
        if any(h in ul for h in _FUNDING_HINTS):
            score += 1
        return -score  # ascending sort → best first

    ranked.sort(key=_rank)
    ranked = ranked[:max_pages]

    # 4. Fetch each candidate and LLM-extract opportunities.
    results: list[dict] = []
    seen_keys: set[str] = set()
    for url in ranked:
        try:
            text, links = await asyncio.to_thread(_fetch_page_text, url, use_playwright)
        except Exception:
            continue
        if not text or len(text) < 120:
            continue
        try:
            items = await _llm_extract(text, source_name, links)
        except Exception:
            continue
        for it in items:
            if not it.get("title"):
                continue
            it["url"] = it.get("url") or url
            key = (it.get("url") or "") + "|" + it["title"].lower()[:80]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            results.append(it)
        if len(results) >= max_results:
            break

    logger.info(
        "agentic_discover complete",
        source=source_name, candidates=len(ranked), found=len(results),
    )
    return results
