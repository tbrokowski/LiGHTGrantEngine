"""
Deduplication helpers for grant opportunities.

Used in two places:
  1. Ingest (discovery_tasks._process_listing) — sync, via SQLAlchemy Session
  2. EU scraper within-run dedup — pure Python, no DB
"""
import re
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.opportunity import Opportunity
from app.scrapers.base import _normalize_url

# Well-known EU programme prefixes
_EU_PREFIX_RE = re.compile(
    r"^(HORIZON|ERC|EIC|DIGITAL|LIFE|CEF|MSCA|WIDERA|EU4HEALTH)-",
    re.I,
)
_TOPIC_DETAILS_RE = re.compile(r"/topic-details/([^/?#]+)", re.I)


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------

def _str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _program_identifier(value: str) -> str | None:
    """
    Return upper-cased programme identifier if *value* looks like one.
    Examples: HORIZON-CL5-2027-07-D3-11, ERC-2025-COG, HORIZON-MSCA-2025-PF-01
    """
    if not value:
        return None
    upper = value.upper().strip()
    # Must start with a known EU prefix and have at least two hyphen segments
    if _EU_PREFIX_RE.match(upper) and upper.count("-") >= 2:
        return upper
    return None


def _slug_from_url(url: str) -> str | None:
    """Extract and normalise the topic-details slug from a portal URL."""
    if not url:
        return None
    m = _TOPIC_DETAILS_RE.search(url)
    if not m:
        return None
    return _program_identifier(m.group(1)) or m.group(1).upper()


def dedup_key(opp: "Opportunity | dict") -> str | None:
    """
    Return a stable deduplication key for a record or listing dict.

    Priority:
      1. Normalised programme identifier  (e.g. program:HORIZON-CL5-2027-07-D3-11)
      2. Normalised opportunity URL       (e.g. url:https://ec.europa.eu/…)
      3. Lower-cased title + funder pair  (e.g. title:some grant|eu – horizon)
    """
    if isinstance(opp, dict):
        program_name = _str(opp.get("program_name") or opp.get("program"))
        url = _str(opp.get("opportunity_url") or opp.get("url"))
        title = _str(opp.get("title"))
        funder = _str(opp.get("funder"))
    else:
        program_name = _str(opp.program_name)
        url = _str(opp.opportunity_url)
        title = _str(opp.title)
        funder = _str(opp.funder)

    identifier = _program_identifier(program_name) or _slug_from_url(url)
    if identifier:
        return f"program:{identifier}"

    if url:
        return f"url:{_normalize_url(url)}"

    if title:
        return f"title:{title.lower()}|{funder.lower()}"

    return None


# ---------------------------------------------------------------------------
# In-memory dedup (used inside a single scraper run)
# ---------------------------------------------------------------------------

def dedup_listings(listings: list[dict]) -> list[dict]:
    """
    Remove duplicate listings within a single scraper run.
    Keeps the first occurrence of each dedup key.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for listing in listings:
        key = dedup_key(listing)
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(listing)
    return out


# ---------------------------------------------------------------------------
# DB-level ingest dedup (sync, Celery worker context)
# ---------------------------------------------------------------------------

def find_existing_duplicate(db: Session, listing: dict) -> "Opportunity | None":
    """
    Check whether an equivalent opportunity already exists in the DB.

    Checks (in order):
      1. Exact opportunity_url match
      2. Case-insensitive program_name match (for EU identifiers)
      3. URL slug match via ILIKE on topic-details path
      4. Case-insensitive title + funder match (fallback)
    """
    call_url = _str(listing.get("url") or listing.get("opportunity_url"))
    program_name = _str(listing.get("program_name") or listing.get("program"))
    title = _str(listing.get("title"))
    funder = _str(listing.get("funder"))

    def _one(stmt):
        return db.execute(stmt).scalar_one_or_none()

    # 1. Exact URL
    if call_url:
        existing = _one(
            select(Opportunity).where(Opportunity.opportunity_url == call_url)
        )
        if existing:
            return existing

    # 2. Programme identifier match (handles cross-source EU duplicates)
    identifier = _program_identifier(program_name) or _slug_from_url(call_url)
    if identifier:
        existing = _one(
            select(Opportunity).where(
                func.upper(Opportunity.program_name) == identifier
            )
        )
        if existing:
            return existing

        # Also match by URL slug in case program_name wasn't stored previously
        slug = identifier.lower()
        existing = _one(
            select(Opportunity).where(
                Opportunity.opportunity_url.ilike(f"%/topic-details/{slug}%")
            )
        )
        if existing:
            return existing

    # 3. Normalised URL via slug (catches www./trailing-slash variants)
    if call_url:
        path_slug = urlparse(call_url).path.rstrip("/").split("/")[-1].lower()
        if path_slug and len(path_slug) > 8:
            existing = _one(
                select(Opportunity).where(
                    Opportunity.opportunity_url.ilike(f"%/{path_slug}%")
                )
            )
            if existing:
                return existing

    # 4. Title + funder fallback
    if title:
        existing = _one(
            select(Opportunity).where(
                func.lower(Opportunity.title) == title.lower(),
                or_(
                    Opportunity.funder.is_(None),
                    func.lower(Opportunity.funder) == funder.lower(),
                ),
            )
        )
        if existing:
            return existing

    return None
