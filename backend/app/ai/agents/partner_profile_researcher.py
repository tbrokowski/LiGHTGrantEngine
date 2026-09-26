"""Research one contact on the open web and build a partner profile.

Starts from what an address book gives you — an email and maybe a name — and
returns title, organization, department, location, a bio, expertise tags and
profile links, each grounded in pages that were actually read.

  1. Search (Exa, and/or Tavily — whichever keys are set): the exact email address (the
     strongest identity anchor — staff pages list it), the name with the
     institution, the name within the email's own domain, and a LinkedIn
     lookup that only reads result URLs.
  2. Scrape the best few profile pages with the shared fetch layer
     (httpx → Playwright escalation). Pages on the email's domain, ORCID and
     publication indexes are preferred; LinkedIn and social sites are never
     fetched, only linked.
  3. OpenAlex author lookup for h-index and recent work.
  4. One LLM pass that must tie each page to this person (email match or an
     affiliation consistent with the email domain) before using it, and
     leaves fields empty rather than guess.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Optional
from urllib.parse import urlparse

import structlog

from app.ai.client import chat_complete
from app.services.email_list_parser import PERSONAL_DOMAINS

logger = structlog.get_logger()

# Never fetched (login walls / ToS) — kept only as links when found in results.
_NO_FETCH_HOSTS = (
    "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "researchgate.net", "scholar.google", "youtube.com", "tiktok.com",
)
_PROFILE_HOST_BONUS = {
    "orcid.org": 3, "pubmed.ncbi.nlm.nih.gov": 1, "openalex.org": 1,
    "loop.frontiersin.org": 2, "scholars.": 2, "experts.": 2, "people.": 2,
}
_MAX_PAGES = 3
_PAGE_CHARS = 5000

_SYSTEM = (
    "You build a research-partner CRM profile for ONE specific person from web "
    "pages. Pages may be about other people with similar names: use a page only "
    "if it contains this person's email address, or names them with an "
    "affiliation consistent with their email domain. Never invent facts. Leave a "
    "field empty when the sources don't state it. Respond with strict JSON only."
)

_SCHEMA = """Return JSON:
{
  "identity_confidence": 0.0-1.0,   // how sure you are the sources are THIS person
  "full_name": "",                  // their full proper name as written on their profile
  "title": "",                      // current job title / academic rank
  "organization": "",               // current primary institution (full name, not acronym)
  "department": "",
  "city": "",
  "country": "",
  "bio": "",                        // 3-5 sentences, third person: role, research focus, notable work
  "expertise_tags": [],             // 4-8 concise research/professional areas
  "linkedin_url": "",               // only a linkedin.com/in/ URL that appears in the sources
  "website": "",                    // their institutional profile / personal page URL
  "orcid": "",                      // bare ORCID iD, e.g. 0000-0002-1825-0097
  "google_scholar_id": "",
  "openalex_matches": false,        // true only if the OpenAlex author is clearly this person
  "sources": []                     // URLs you actually relied on
}"""


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def _root_domain(domain: str) -> str:
    """wits.ac.za → wits.ac.za; mail.med.upenn.edu → upenn.edu (best effort)."""
    parts = domain.split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in {"ac", "co", "or", "edu", "gov", "org", "com", "ne"}:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _html_to_text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "form", "svg"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    return re.sub(r"\s+", " ", text)


def _focus(text: str, needles: list[str], limit: int) -> str:
    """Trim a page to the window around the first mention of the person, so a
    long department listing doesn't bury them past the character budget."""
    if len(text) <= limit:
        return text
    low = text.lower()
    for n in needles:
        if n and (i := low.find(n.lower())) >= 0:
            start = max(0, i - limit // 4)
            return text[start:start + limit]
    return text[:limit]


def _score_candidate(r: dict, email: str, surname: str, domain_root: str) -> float:
    url = r.get("url") or ""
    host = _host(url)
    if not host or any(b in host for b in _NO_FETCH_HOSTS):
        return -1
    blob = f"{r.get('title', '')} {r.get('content', '')}".lower()
    score = float(r.get("score") or 0)
    if email and email in blob:
        score += 4
    if surname and surname.lower() in blob:
        score += 2
    elif surname:
        score -= 2
    if domain_root and host.endswith(domain_root):
        score += 3
    for key, bonus in _PROFILE_HOST_BONUS.items():
        if key in host:
            score += bonus
    if url.lower().endswith(".pdf"):
        score -= 1.5
    return score


_PARTICLES = {"van", "von", "de", "der", "den", "du", "da", "di", "del", "della", "le", "la",
              "bin", "binti", "al", "el", "dos", "das", "ter", "ten"}
MAX_QUERIES = 7


def split_name(name: str) -> dict:
    """Break a display name into the pieces people are listed under online.

    "Klaus Reither"        → first Klaus, last Reither, initial K
    "A Redfern" / "A. Redfern" → last Redfern, initial A (no first name)
    "James van Duuren"     → first James, last "van Duuren", initial J
    "Djite"                → single Djite (could be a first or last name)
    """
    tokens = [t.strip(".,") for t in (name or "").split() if t.strip(".,")]
    out = {"first": "", "last": "", "initial": "", "single": ""}
    if not tokens:
        return out
    if len(tokens) == 1:
        out["single"] = tokens[0]
        return out
    i = len(tokens) - 1
    while i > 1 and tokens[i - 1].lower() in _PARTICLES:
        i -= 1
    out["last"] = " ".join(tokens[i:])
    given = tokens[:i]
    out["initial"] = given[0][0].upper()
    if len(given[0]) > 1:
        out["first"] = given[0]
    return out


def _topic_tags(tags: Optional[list], limit: int = 2) -> list[str]:
    """Tags that describe what someone works on — not facets (need:)
    or bookkeeping labels like "consortium-2026"."""
    out = []
    for t in tags or []:
        t = str(t).strip()
        if not t or ":" in t or any(ch.isdigit() for ch in t):
            continue
        out.append(t)
        if len(out) == limit:
            break
    return out


def build_queries(
    email: str, name: str, name_guessed: bool, organization: str, domain_root: str,
    tags: Optional[list] = None,
) -> list[tuple[str, dict]]:
    """Search queries for one person, strongest first, de-duplicated and
    capped at MAX_QUERIES: exact email; full name + institution; name within
    their institution's own site; initial + surname; institution + surname;
    LinkedIn; surname + research tags. A lone first name at a personal
    address ("Akim" at gmail) only gets the email search — anything else
    would return strangers."""
    parts = split_name(name)
    first, last, initial, single = parts["first"], parts["last"], parts["initial"], parts["single"]
    anchor = organization or domain_root
    topics = _topic_tags(tags)
    q = (lambda text: text) if name_guessed else (lambda text: f'"{text}"')

    candidates: list[tuple[str, dict]] = []
    if email:
        candidates.append((f'"{email}"', {}))
    if last:
        full = f"{first} {last}" if first else f"{initial} {last}"
        if first:
            candidates.append((f"{q(full)} {anchor}".strip(), {}))
        if domain_root:
            candidates.append((full, {"include_domains": [domain_root]}))
        candidates.append((f"{q(f'{initial}. {last}')} {anchor}".strip(), {}))
        if anchor:
            candidates.append((f"{q(last)} {anchor}", {}))
        candidates.append((f"{full} {anchor} LinkedIn".strip(), {"include_domains": ["linkedin.com"]}))
        if topics:
            candidates.append((f"{q(last)} {' '.join(topics)}", {}))
    elif single and (domain_root or organization):
        # One name, no idea if it's first or last: stay inside their institution.
        if domain_root:
            candidates.append((single, {"include_domains": [domain_root]}))
        candidates.append((f"{single} {anchor}", {}))
        if topics:
            candidates.append((f"{single} {anchor} {' '.join(topics)}", {}))

    seen: set[tuple] = set()
    out: list[tuple[str, dict]] = []
    for text, kw in candidates:
        key = (" ".join(text.lower().split()), tuple(kw.get("include_domains") or []))
        if key not in seen:
            seen.add(key)
            out.append((text, kw))
    return out[:MAX_QUERIES]


async def _search_all(queries: list[tuple[str, dict]]) -> list[dict]:
    """Run every query on each configured provider and merge by URL.

    Exa (EXA_API_KEY) is preferred — its index is good at people and profile
    pages. Tavily (TAVILY_API_KEY) runs too when configured, and is the
    fallback when Exa isn't. With neither key, search returns nothing and
    research falls back to publication data.
    """
    from app.config import get_settings
    from app.services.exa_search import exa_search
    from app.services.web_search import search_web

    settings = get_settings()
    use_exa = bool(settings.exa_api_key)
    use_tavily = bool(settings.tavily_api_key) or not use_exa

    tasks = []
    for q, kw in queries:
        if use_exa:
            tasks.append(exa_search(q, num_results=6, include_domains=kw.get("include_domains")))
        if use_tavily:
            tasks.append(search_web(q, max_results=6, **kw))
    results = await asyncio.gather(*tasks, return_exceptions=True)
    merged: dict[str, dict] = {}
    for batch in results:
        if isinstance(batch, Exception) or not batch:
            continue
        for r in batch:
            url = (r.get("url") or "").split("#")[0]
            if url and url not in merged:
                merged[url] = r
    return list(merged.values())


async def _scrape(url: str) -> str:
    from app.scrapers.fetch import fetch_page

    try:
        res = await asyncio.to_thread(fetch_page, url, timeout=20)
    except Exception as exc:
        logger.info("partner_research fetch failed", url=url, error=str(exc))
        return ""
    if not res.ok:
        return ""
    # Parsing a large page is CPU work — keep it off the event loop too.
    return await asyncio.to_thread(_html_to_text, res.html)


async def research_contact(
    email: Optional[str],
    name: Optional[str] = None,
    organization: Optional[str] = None,
    title: Optional[str] = None,
    orcid: Optional[str] = None,
    name_guessed: bool = False,
    tags: Optional[list] = None,
) -> dict:
    """Research one person. Returns the profile dict described in `_SCHEMA`
    plus `h_index`, `recent_publications` and `enrichment_source`; fields the
    sources don't support come back empty."""
    from app.ai.agents.partner_enrichment_agent import _search_openalex_author

    email = (email or "").strip().lower()
    domain = email.partition("@")[2]
    institutional = bool(domain) and domain not in PERSONAL_DOMAINS
    domain_root = _root_domain(domain) if institutional else ""
    name = (name or "").strip()
    parts = split_name(name)
    # Surname used to judge search hits; unknown for a lone guessed name.
    surname = parts["last"]

    queries = build_queries(email, name, name_guessed, organization or "", domain_root, tags)
    if not queries:
        return {}
    # OpenAlex needs at least an initial + surname to find the right author.
    openalex_name = name if parts["last"] and not (name_guessed and not parts["first"]) else ""

    results, openalex = await asyncio.gather(
        _search_all(queries),
        _search_openalex_author(openalex_name, orcid, organization) if openalex_name else asyncio.sleep(0),
    )

    linkedin_urls = [
        r["url"] for r in results
        if "linkedin.com/in/" in (r.get("url") or "")
        and (not surname or surname.lower() in f"{r.get('title', '')} {r['url']}".lower())
    ]

    ranked = sorted(
        (r for r in results if _score_candidate(r, email, surname, domain_root) > 0),
        key=lambda r: _score_candidate(r, email, surname, domain_root),
        reverse=True,
    )[:_MAX_PAGES]
    pages = list(await asyncio.gather(*(_scrape(r["url"]) for r in ranked)))
    blocked = [r["url"] for r, text in zip(ranked, pages) if not text]
    if blocked:
        # Pages our fetcher couldn't read (bot walls, JS-only) — Exa serves its
        # own crawl of them when a key is configured; a no-op otherwise.
        from app.services.exa_search import exa_get_contents
        try:
            got = {g["url"]: g.get("content") or "" for g in await exa_get_contents(blocked, max_characters=_PAGE_CHARS)}
        except Exception:
            got = {}
        pages = [text or got.get(r["url"], "") for r, text in zip(ranked, pages)]

    needles = [email, name, surname]
    sections: list[str] = []
    for r, text in zip(ranked, pages):
        body = _focus(text, needles, _PAGE_CHARS) if text else (r.get("content") or "")[:1200]
        if body:
            sections.append(f"### PAGE {r['url']}\n{body}")
    # Search snippets from pages we didn't fetch still help identify the person.
    fetched = {r["url"] for r in ranked}
    snippets = [
        f"- {r.get('url')}: {(r.get('content') or '')[:300]}"
        for r in results if r.get("url") not in fetched
    ][:10]

    if not sections and not snippets and not openalex:
        return {"enrichment_source": "none", "sources": []}

    context = "\n\n".join(sections)
    if snippets:
        context += "\n\n### OTHER SEARCH RESULTS\n" + "\n".join(snippets)
    if linkedin_urls:
        context += "\n\n### LINKEDIN URLS FOUND\n" + "\n".join(linkedin_urls[:3])
    if openalex:
        context += (
            f"\n\n### OPENALEX AUTHOR\n{openalex.get('summary')}\n"
            f"h-index: {openalex.get('h_index')}\n"
            f"recent works: {json.dumps(openalex.get('publications', [])[:5], default=str)}"
        )

    known = (
        f"Email: {email or 'unknown'}\n"
        f"Name: {name or 'unknown'}{' (guessed from the email address — confirm or correct it)' if name_guessed else ''}\n"
        f"Organization: {organization or ('unknown; email domain is ' + domain if domain else 'unknown')}\n"
        f"Title: {title or 'unknown'}"
    )
    try:
        raw = await chat_complete(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"PERSON\n{known}\n\nSOURCES\n{context[:18000]}\n\n{_SCHEMA}"},
            ],
            agent_name="partner_enrichment", json_mode=True, max_tokens=1500, temperature=0.1,
        )
        profile = json.loads(raw)
        if not isinstance(profile, dict):
            profile = {}
    except Exception as exc:
        logger.warning("partner_research synthesis failed", email=email, error=str(exc))
        profile = {}

    # Low identity confidence → keep only what's safe (nothing person-specific).
    if float(profile.get("identity_confidence") or 0) < 0.5:
        profile = {"identity_confidence": profile.get("identity_confidence") or 0, "sources": []}

    if profile.get("linkedin_url") and "linkedin.com/in/" not in profile["linkedin_url"]:
        profile["linkedin_url"] = ""
    if openalex and profile.get("openalex_matches"):
        profile["h_index"] = openalex.get("h_index")
        profile["recent_publications"] = openalex.get("publications", [])[:5]
    # With no web page about them, the only source is publication metadata,
    # whose affiliations are historical and often list co-authors' institutes.
    # Keep research areas, h-index and a bio from it, but not where they work now.
    if not sections and not snippets:
        for field in ("organization", "department", "title", "city", "country", "website"):
            profile[field] = ""
    elif isinstance(profile.get("organization"), str) and "," in profile["organization"] and domain_root:
        # "A, B" lists aren't a current employer; keep the first only.
        profile["organization"] = profile["organization"].split(",")[0].strip()
    profile["expertise_tags"] = [t for t in (profile.get("expertise_tags") or []) if isinstance(t, str) and t.strip()][:8]
    profile["sources"] = [s for s in (profile.get("sources") or []) if isinstance(s, str) and s.startswith("http")][:8]
    profile["enrichment_source"] = "web+openalex" if profile.get("h_index") else "web"
    return profile
