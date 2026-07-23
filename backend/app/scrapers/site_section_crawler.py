"""
Site-section crawler for portals with multiple independent grant program indexes.

Portals like Pro Helvetia have 4+ sub-pages under different paths, each listing
a separate set of funding programs. A single `crawl_depth=1` fetch on the root
URL misses them all. This module runs a parallel depth-1 crawl across each
configured section path and merges the results.

Example scraper_config:
    {
        "use_playwright": true,
        "site_sections": [
            "/en/our-funding-areas/creation/",
            "/en/our-funding-areas/circulation/"
        ]
    }
"""
from __future__ import annotations

import asyncio
import re
import structlog

logger = structlog.get_logger()

_MAX_DETAIL_LINKS_PER_SECTION = 5


def crawl_sections(
    base_url: str,
    sections: list[str],
    source_name: str,
    use_playwright: bool = True,
    link_filter: str | None = None,
    max_detail_links_per_section: int = _MAX_DETAIL_LINKS_PER_SECTION,
) -> list[dict]:
    """
    Crawl each section path independently and merge the results.

    Args:
        base_url: Root URL of the portal (e.g. "https://prohelvetia.ch").
        sections: List of path segments to crawl (e.g. ["/en/funding/creation/"]).
        source_name: Human-readable source name for logging.
        use_playwright: Whether to use Playwright for JS rendering.
        link_filter: Optional regex to restrict which detail links to follow.
        max_detail_links_per_section: Cap on detail pages followed per section
            (a listing page that links to many call sub-pages needs a higher cap
            than the default; downloadable call documents on the section page
            itself are extracted directly and don't count against this).

    Returns:
        Merged list of raw opportunity dicts (not yet normalised).
    """
    from urllib.parse import urljoin
    from app.scrapers.ai_scraper import _fetch_page_text, _llm_extract, _is_document_url

    results: list[dict] = []
    pattern = re.compile(link_filter, re.I) if link_filter else None

    async def _crawl_one(section_url: str) -> list[dict]:
        section_results: list[dict] = []
        try:
            page_text, page_links = await asyncio.to_thread(
                _fetch_page_text, section_url, use_playwright
            )
        except Exception as e:
            logger.warning("SiteSectionCrawler: section fetch failed",
                           url=section_url, error=str(e))
            return section_results

        listings = await _llm_extract(page_text, source_name, page_links)
        for item in listings:
            if item.get("title"):
                item.setdefault("url", None)
                section_results.append(item)

        # Follow detail links within the section. Skip document links — those are
        # already handled as opportunities by the listing extraction above, and
        # re-fetching a PDF as an HTML "detail page" is wasteful.
        candidates = [
            href for _, href in page_links
            if (pattern.search(href) if pattern else True)
            and href.rstrip("/") != section_url.rstrip("/")
            and not _is_document_url(href)
        ][:max_detail_links_per_section]

        for detail_url in candidates:
            try:
                detail_text, detail_links = await asyncio.to_thread(
                    _fetch_page_text, detail_url, use_playwright
                )
                detail_items = await _llm_extract(detail_text, source_name, detail_links)
                for item in detail_items:
                    item["url"] = item.get("url") or detail_url
                    if item.get("title"):
                        section_results.append(item)
            except Exception as e:
                logger.warning("SiteSectionCrawler: detail page failed",
                               url=detail_url, error=str(e))

        return section_results

    async def _run_all():
        section_urls = [urljoin(base_url, s) for s in sections]
        batches = await asyncio.gather(*[_crawl_one(u) for u in section_urls])
        for batch in batches:
            results.extend(batch)

    asyncio.run(_run_all())

    logger.info("SiteSectionCrawler complete",
                source=source_name, sections=len(sections), found=len(results))
    return results
