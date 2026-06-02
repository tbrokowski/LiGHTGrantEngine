"""
Agentic source discovery engine.

Generates diverse, rotating search queries across arts/science/humanities/impact
domains and uses Exa.ai neural search to surface new funding portals. Each
candidate URL is LLM-evaluated to determine whether it is a genuine funding
portal (vs a news article, aggregator, or results page). High-confidence
candidates (>= 70) are returned for DB insertion.

Query rotation is Redis-backed: recently-used queries are tracked with a 30-day
TTL so each run explores new territory instead of re-checking the same sites.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Query matrix
# ---------------------------------------------------------------------------

_DOMAINS = [
    # Arts & Culture
    "visual art", "contemporary art", "theatre", "dance", "music", "film",
    "documentary", "photography", "architecture", "design", "literature",
    "poetry", "translation", "digital art", "media art", "new media",
    "animation", "public art", "ceramics", "illustration", "comics",
    "sound art", "video art", "installation art", "fashion",
    # Sciences
    "climate", "ecology", "biodiversity", "public health", "global health",
    "biomedical", "life sciences", "neuroscience", "artificial intelligence",
    "materials science", "epidemiology", "mental health", "physics",
    "mathematics", "chemistry", "genomics", "robotics", "data science",
    # Humanities & Social
    "history", "archaeology", "anthropology", "philosophy", "linguistics",
    "education", "sociology", "political science", "economics", "law",
    "ethics", "journalism", "investigative journalism", "podcast",
    # Impact
    "social entrepreneurship", "civic tech", "community development",
    "circular economy", "clean energy", "international development",
    "humanitarian aid", "sustainable development", "food systems", "migration",
]

_OPP_TYPES = [
    "grant", "fellowship", "scholarship", "open call", "prize", "award",
    "residency", "artist residency", "commission", "bursary", "stipend",
    "call for proposals", "call for projects", "travel grant", "production grant",
    "postdoctoral fellowship", "doctoral fellowship", "emerging artist award",
]

_GEOGRAPHIES = [
    "United States", "European", "Swiss", "UK", "Canadian", "German", "French",
    "Italian", "Spanish", "Dutch", "Belgian", "Nordic", "Scandinavian",
    "Australian", "global", "international", "African", "Latin American",
    "Southeast Asian", "Middle Eastern", "New York", "California",
    "developing countries", "Global South",
]

_APPLICANT_TYPES = [
    "individual artist", "early career researcher", "nonprofit",
    "independent artist", "emerging artist", "mid-career artist", "student",
    "postdoctoral researcher", "PhD student", "collective", "arts organization",
]

# Pre-built niche seed queries for known under-indexed funders
_NICHE_SEEDS = [
    "Pro Helvetia open calls grants",
    "Goethe Institut Künstlerförderung grants",
    "Mondriaan Fund grants Netherlands",
    "Prince Claus Fund cultural grants",
    "Fondazione Compagnia di San Paolo grants",
    "Jan Michalski Foundation fellowship",
    "Creative Capital grant artists",
    "United States Artists fellowship",
    "Artadia grant visual art",
    "MAP Fund performing arts grants",
    "Foundation for Contemporary Arts grants",
    "Jerome Foundation grants",
    "Institut français AFAA cultural grants",
    "British Council Arts grants international",
    "Arts Council England grants",
    "Creative Scotland funding opportunities",
    "Arts Council Ireland grants",
    "Nordic Culture Fund grants",
    "Creative Europe MEDIA grants",
    "Eurimages film grants",
    "Robert Bosch Stiftung grants",
    "Volkswagen Stiftung Förderung",
    "Mercator Stiftung Förderung",
    "Leenaards Foundation grants Switzerland",
    "Sundance Institute grants",
    "Tribeca Foundation grants",
    "IDA documentary grants",
    "Ars Electronica open call",
    "Transmediale open call grants",
    "Creative Time grants public art",
    "Franklin Furnace artist grants",
    "Lower Manhattan Cultural Council grants",
    "New England Foundation for the Arts",
    "Mid Atlantic Arts grants",
    "Guggenheim Fellowship application",
    "Rome Prize American Academy",
    "MacArthur Foundation Fellows",
    "Whiting Foundation grants",
    "ACLS American Council Learned Societies fellowship",
    "Mellon Foundation grants",
    "Knight Foundation arts grants",
    "Leverhulme Trust grants UK",
    "Nuffield Foundation grants",
    "Esmée Fairbairn Foundation grants",
    "Paul Hamlyn Foundation grants",
    "Joyce Foundation grants",
    "Pew Charitable Trusts arts grants",
    "Schmidt Futures grants",
    "Alfred P Sloan Foundation grants",
    "Simons Foundation grants",
    "Open Society Foundations grants",
    "Heinrich Böll Stiftung Stipendien",
    "Comic Relief grants",
    "Porticus Foundation grants",
]


def _build_query_pool() -> list[str]:
    """Cross-product of matrix dimensions, shuffled."""
    import random
    pool: list[str] = []
    for domain in _DOMAINS:
        for opp_type in _OPP_TYPES[:6]:
            pool.append(f"{domain} {opp_type} portal")
    for geo in _GEOGRAPHIES:
        for opp_type in _OPP_TYPES[:4]:
            domain = random.choice(_DOMAINS[:10])
            pool.append(f"{geo} {domain} {opp_type}")
    for applicant in _APPLICANT_TYPES:
        for opp_type in _OPP_TYPES[:5]:
            pool.append(f"{opp_type} for {applicant}")
    return pool


def generate_queries(n: int, redis_client=None) -> list[str]:
    """
    Return n query strings, prioritising least-recently-used ones.
    Always includes ~n//4 niche seed queries.
    """
    import random

    pool = _build_query_pool()
    random.shuffle(pool)

    used_key = "discovery:used_queries"
    used: set[str] = set()

    if redis_client:
        try:
            raw = redis_client.smembers(used_key)
            used = {m.decode() if isinstance(m, bytes) else m for m in raw}
        except Exception:
            pass

    # Prioritise unused queries
    fresh = [q for q in pool if q not in used]
    stale = [q for q in pool if q in used]

    # Pick niche seeds (always rotate in a quarter)
    n_seeds = max(1, n // 4)
    seeds = random.sample(_NICHE_SEEDS, min(n_seeds, len(_NICHE_SEEDS)))

    n_matrix = n - len(seeds)
    chosen_matrix = (fresh + stale)[:n_matrix]
    chosen = seeds + chosen_matrix

    if redis_client:
        try:
            for q in chosen:
                redis_client.sadd(used_key, q)
            redis_client.expire(used_key, 30 * 24 * 3600)
        except Exception:
            pass

    return chosen[:n]


def domain_key(url: str) -> str:
    """Normalise URL to hostname, stripping www. prefix."""
    try:
        host = urlparse(url).hostname or ""
        return re.sub(r"^www\.", "", host).lower()
    except Exception:
        return ""


async def evaluate_candidate(
    title: str,
    url: str,
    snippet: str,
) -> dict:
    """
    Ask an LLM whether this URL is a genuine funding portal.

    Returns a dict:
      {is_portal, confidence, source_name, funder_name, category,
       opportunity_types, geographies, scraper_type, notes}
    """
    from app.ai.client import chat_complete

    _SYSTEM = (
        "You are a funding portal classifier. "
        "Given a web page title, URL, and snippet, decide whether it is a genuine "
        "funding portal — an organisation's own page that lists grants, fellowships, "
        "open calls, prizes, scholarships, residencies, or similar opportunities. "
        "\n\nNOT a portal: news articles, aggregator sites (like GrantWatch, Candid, "
        "Instrumentl), blog posts, award-history pages, Wikipedia, general info pages. "
        "\n\nRespond with ONLY valid JSON:\n"
        "{\n"
        '  "is_portal": true|false,\n'
        '  "confidence": 0-100,\n'
        '  "source_name": "Short human-readable name",\n'
        '  "funder_name": "Organisation name",\n'
        '  "category": "Arts & Culture|Fellowships|Science & Research|International Development|US Federal|European|Other",\n'
        '  "opportunity_types": ["grant","fellowship","open_call",...],\n'
        '  "geographies": ["Global","Switzerland","US",...],\n'
        '  "scraper_type": "ai_scraper|rss|html_scraper",\n'
        '  "notes": "one-line note"\n'
        "}"
    )

    prompt = f"Title: {title}\nURL: {url}\nSnippet: {snippet[:600]}"

    try:
        raw = await chat_complete(
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=300,
            agent_name="source_discovery",
            json_mode=True,
        )
        result = json.loads(raw)
        result.setdefault("is_portal", False)
        result.setdefault("confidence", 0)
        return result
    except Exception:
        return {"is_portal": False, "confidence": 0}


async def discover_portal_candidates(
    queries: list[str],
    known_domains: set[str],
    *,
    min_confidence: int = 70,
) -> list[dict]:
    """
    Run Exa searches for each query, evaluate candidates, and return portals
    with confidence >= min_confidence.

    Also runs find_similar on the top-5 newly discovered portals to surface peers.
    """
    from app.services.exa_search import exa_search, exa_find_similar

    # Collect all search results, dedup by domain
    seen_domains: set[str] = set(known_domains)
    candidates: list[dict] = []  # {title, url, snippet}

    async def _search_one(query: str) -> list[dict]:
        try:
            results = await exa_search(query, num_results=10)
            return results
        except Exception:
            return []

    all_results = await asyncio.gather(*[_search_one(q) for q in queries])

    for batch in all_results:
        for r in batch:
            dk = domain_key(r.get("url", ""))
            if dk and dk not in seen_domains:
                seen_domains.add(dk)
                candidates.append(r)

    # LLM-evaluate in batches of 10
    evaluated: list[dict] = []

    async def _eval(r: dict) -> dict:
        result = await evaluate_candidate(r["title"], r["url"], r.get("content", ""))
        result["url"] = r["url"]
        return result

    batch_size = 10
    for i in range(0, len(candidates), batch_size):
        batch = candidates[i : i + batch_size]
        results = await asyncio.gather(*[_eval(r) for r in batch], return_exceptions=True)
        for res in results:
            if isinstance(res, dict):
                evaluated.append(res)

    # Find peers of the top newly discovered portals
    top_new = sorted(
        [e for e in evaluated if e.get("is_portal") and e.get("confidence", 0) >= min_confidence],
        key=lambda x: x.get("confidence", 0),
        reverse=True,
    )[:5]

    peer_candidates: list[dict] = []
    if top_new:
        peer_batches = await asyncio.gather(
            *[exa_find_similar(p["url"], num_results=8) for p in top_new],
            return_exceptions=True,
        )
        for batch in peer_batches:
            if isinstance(batch, list):
                for r in batch:
                    dk = domain_key(r.get("url", ""))
                    if dk and dk not in seen_domains:
                        seen_domains.add(dk)
                        peer_candidates.append(r)

        if peer_candidates:
            peer_results = await asyncio.gather(
                *[_eval(r) for r in peer_candidates], return_exceptions=True
            )
            for res in peer_results:
                if isinstance(res, dict):
                    evaluated.append(res)

    portals = [e for e in evaluated if e.get("is_portal") and e.get("confidence", 0) >= min_confidence]

    # Prefer RSS where available — cheaper and more reliable than AI scraping
    for portal in portals:
        url = portal.get("url", "")
        if url and portal.get("scraper_type") != "rss":
            try:
                from app.scrapers.base import detect_feed
                feed_url = detect_feed(url, timeout=5)
                if feed_url:
                    portal["scraper_type"] = "rss"
                    portal["feed_url"] = feed_url
            except Exception:
                pass

    return portals
