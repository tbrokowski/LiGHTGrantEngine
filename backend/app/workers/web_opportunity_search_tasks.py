"""
Direct web-search opportunity finder.

Complements portal scraping: many one-off grants, fellowships, conference
travel awards, and workshops never appear on a scrapeable portal we track.
This task searches the web directly (Exa preferred, Tavily fallback — same
provider selection as source discovery), classifies each hit with gpt-4o-mini
as a *specific opportunity page* vs a *portal* vs junk, and:

  - specific opportunity → inserted through discovery_tasks._process_listing
    (same dedup + surface + enrich → tag → score chain as scraped listings,
    so org/personal keyword ranking and the taste profile apply for free)
  - portal → created as an under_review Source for the existing pipeline

Queries are built from each institution's grant_profile keywords × opportunity
types × geographies, Redis-rotated with a 30-day TTL so weekly runs explore
new territory. Results attribute to a synthetic paused "Web Search" Source row
(never scanned; exists only so opportunities have a source_id).
"""
from __future__ import annotations
from app.db_sync import get_sync_engine

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_WEB_SEARCH_SOURCE_NAME = "Web Search (direct discovery)"
_USED_QUERIES_KEY = "web_opp_search:used_queries"
_QUERIES_PER_RUN = 20
_RESULTS_PER_QUERY = 8

_OPP_TYPE_TERMS = [
    "grant", "fellowship", "scholarship", "open call",
    "conference travel grant", "workshop funding", "call for papers",
    "summer school funding", "prize",
]

_CLASSIFY_SYSTEM = (
    "You classify web pages for a grant-discovery system. Given a page title, "
    "URL, and snippet, decide what it is.\n\n"
    'Respond with ONLY valid JSON:\n'
    '{\n'
    '  "kind": "opportunity" | "portal" | "other",\n'
    '  "title": "clean opportunity title",\n'
    '  "funder": "funding organisation name or null",\n'
    '  "deadline": "YYYY-MM-DD or null",\n'
    '  "opportunity_type": "grant|fellowship|scholarship|residency|open_call|'
    'prize|bursary|commission|conference|workshop|other"\n'
    "}\n\n"
    '"opportunity" = a page for ONE specific grant/fellowship/scholarship/'
    "conference-funding/workshop call that someone can apply to.\n"
    '"portal" = an organisation page LISTING multiple funding opportunities.\n'
    '"other" = news, blog posts, aggregator spam, expired/awarded results, '
    "or anything else."
)


def _build_queries(keywords: list[str], geographies: list[str], n: int, redis_client) -> list[str]:
    """Cross keywords × opportunity-type terms (± geography), Redis-rotated."""
    import random

    pool: list[str] = []
    for kw in keywords:
        for term in _OPP_TYPE_TERMS:
            pool.append(f"{kw} {term} 2026")
    for geo in geographies[:5]:
        for kw in keywords[:5]:
            pool.append(f"{kw} grant {geo}")
    random.shuffle(pool)

    used: set[str] = set()
    if redis_client:
        try:
            raw = redis_client.smembers(_USED_QUERIES_KEY)
            used = {m.decode() if isinstance(m, bytes) else m for m in raw}
        except Exception:
            pass

    fresh = [q for q in pool if q not in used]
    stale = [q for q in pool if q in used]
    chosen = (fresh + stale)[:n]

    if redis_client:
        try:
            for q in chosen:
                redis_client.sadd(_USED_QUERIES_KEY, q)
            redis_client.expire(_USED_QUERIES_KEY, 30 * 24 * 3600)
        except Exception:
            pass
    return chosen


async def _classify_hit(title: str, url: str, snippet: str) -> dict:
    from app.ai.client import chat_complete

    try:
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": _CLASSIFY_SYSTEM},
                {"role": "user", "content": f"Title: {title}\nURL: {url}\nSnippet: {snippet[:600]}"},
            ],
            temperature=0.0,
            max_tokens=250,
            agent_name="web_opportunity_classifier",
            json_mode=True,
        )
        parsed = json.loads(raw)
        parsed.setdefault("kind", "other")
        return parsed
    except Exception:
        return {"kind": "other"}


def _get_or_create_web_search_source(db: Session):
    from app.models.source import Source

    src = db.execute(
        select(Source).where(Source.name == _WEB_SEARCH_SOURCE_NAME)
    ).scalar_one_or_none()
    if not src:
        src = Source(
            id=str(uuid.uuid4()),
            name=_WEB_SEARCH_SOURCE_NAME,
            url=None,
            source_type="manual",
            category="Web Search",
            # Paused so scan_all_sources never tries to "scrape" it — this row
            # exists purely to attribute directly-discovered opportunities.
            status="paused",
            scraper_config={"_synthetic": True},
            notes="Synthetic source: opportunities found by the direct web-search task.",
        )
        db.add(src)
        db.flush()
    return src


@celery_app.task(name="app.workers.web_opportunity_search_tasks.search_opportunities_for_institution",
                 bind=True, max_retries=1)
def search_opportunities_for_institution(self, institution_id: str) -> dict:
    """Search the web for opportunities matching one institution's profile."""
    import redis as redis_lib

    from app.config import get_settings
    from app.models.institution import Institution
    from app.scrapers.source_discovery import search_provider, domain_key
    from app.schemas.grant_profile import GrantProfile
    from app.workers.discovery_tasks import _process_listing

    settings = get_settings()
    provider = search_provider()
    if not provider:
        logger.error("web opportunity search skipped — no EXA/TAVILY key configured")
        return {"skipped": True, "reason": "no_search_provider"}

    engine = get_sync_engine()
    try:
        redis_client = redis_lib.from_url(settings.redis_url)
    except Exception:
        redis_client = None

    with Session(engine) as db:
        inst = db.get(Institution, institution_id)
        if not inst:
            return {"skipped": True, "reason": "institution_not_found"}
        profile = GrantProfile.from_dict(inst.grant_profile or {})
        if not profile.keywords:
            return {"skipped": True, "reason": "no_profile_keywords"}

        queries = _build_queries(profile.keywords, profile.geographies, _QUERIES_PER_RUN, redis_client)

        async def _search_all() -> list[dict]:
            from app.services.exa_search import exa_search
            from app.services.web_search import search_web

            async def _one(q: str) -> list[dict]:
                try:
                    if provider == "tavily":
                        return await search_web(q, max_results=_RESULTS_PER_QUERY)
                    return await exa_search(q, num_results=_RESULTS_PER_QUERY)
                except Exception:
                    return []

            nested = await asyncio.gather(*[_one(q) for q in queries])
            merged: list[dict] = []
            seen_urls: set[str] = set()
            for batch in nested:
                for r in batch:
                    u = (r.get("url") or "").strip()
                    if u and u not in seen_urls:
                        seen_urls.add(u)
                        merged.append(r)
            return merged

        hits = asyncio.run(_search_all())
        logger.info("web opportunity search: %d unique hits from %d queries (%s)",
                    len(hits), len(queries), provider)

        web_source = _get_or_create_web_search_source(db)

        # Known domains — don't recreate portals we already track
        from app.models.source import Source
        known_domains = {
            domain_key(u) for (u,) in db.execute(select(Source.url)).all() if u
        }

        created = duplicates = portals = other = 0
        for hit in hits:
            url = hit.get("url") or ""
            cls = asyncio.run(_classify_hit(hit.get("title") or "", url, hit.get("content") or ""))
            kind = cls.get("kind")

            if kind == "opportunity":
                listing = {
                    "title": cls.get("title") or hit.get("title") or "",
                    "description": hit.get("content") or "",
                    "url": url,
                    "funder": cls.get("funder"),
                    "deadline": cls.get("deadline"),
                    "opportunity_type": cls.get("opportunity_type"),
                    "raw_text": json.dumps(hit)[:2000],
                }
                if not listing["title"]:
                    other += 1
                    continue
                outcome = _process_listing(db, listing, web_source.id, None, source_type="manual")
                if outcome == "new":
                    created += 1
                elif outcome == "duplicate":
                    duplicates += 1
                else:
                    other += 1

            elif kind == "portal":
                dk = domain_key(url)
                if dk and dk not in known_domains:
                    known_domains.add(dk)
                    db.add(Source(
                        id=str(uuid.uuid4()),
                        name=cls.get("funder") or cls.get("title") or dk,
                        url=url,
                        source_type="ai_scraper",
                        category="Web Search Discovery",
                        status="under_review",
                        scraper_config={"use_playwright": True, "crawl_depth": 1},
                        notes=f"Found by direct web search on {datetime.now(timezone.utc).date()}",
                    ))
                    portals += 1
            else:
                other += 1

        db.commit()

    result = {
        "institution_id": institution_id,
        "hits": len(hits),
        "opportunities_created": created,
        "duplicates": duplicates,
        "portals_created": portals,
        "other": other,
    }
    logger.info("web opportunity search complete: %s", result)
    return result


@celery_app.task(name="app.workers.web_opportunity_search_tasks.search_opportunities_all")
def search_opportunities_all() -> dict:
    """Weekly fan-out: run the direct web search for every institution with a profile."""
    from app.config import get_settings
    from app.models.institution import Institution

    settings = get_settings()
    engine = get_sync_engine()
    queued = 0
    with Session(engine) as db:
        for inst in db.execute(select(Institution)).scalars().all():
            if (inst.grant_profile or {}).get("keywords"):
                search_opportunities_for_institution.apply_async(
                    args=[inst.id], countdown=queued * 60,  # stagger 1/min
                )
                queued += 1
    return {"institutions_queued": queued}
