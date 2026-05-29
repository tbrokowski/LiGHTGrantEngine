"""
Deduplication helpers for grant opportunities.

Used in two places:
  1. Ingest (discovery_tasks._process_listing) — sync, via SQLAlchemy Session
  2. Within-run dedup (dedup_listings) — pure Python, no DB

Strategy — multi-signal composite scoring:
  Score ≥ 70  → definitive duplicate, block ingest
  Score 40–69 → ingest but mark POSSIBLE_DUPLICATE for human review

Signal weights:
  100  External ID match (opportunity_number / normalised program_name)
   80  Grant-specific URL path match (ID in path, not query-only)
   70  Normalised title + funder prefix + deadline within 60 days
   50  Normalised title + funder prefix (no deadline constraint)
   30  Normalised title + same source_id (weak, same-source only)
"""
import re
from datetime import date
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.opportunity import Opportunity
from app.scrapers.base import _normalize_url

# ---------------------------------------------------------------------------
# Regex constants
# ---------------------------------------------------------------------------

# EU programme identifiers  e.g. HORIZON-CL5-2027-07-D3-11, ERC-2025-COG
_EU_PREFIX_RE = re.compile(
    r"^(HORIZON|ERC|EIC|DIGITAL|LIFE|CEF|MSCA|WIDERA|EU4HEALTH)-",
    re.I,
)
_TOPIC_DETAILS_RE = re.compile(r"/topic-details/([^/?#]+)", re.I)

# NIH project numbers  e.g. 1R01AI123456-01
# Capture group 1 = base without activity-year digit and supplement suffix
_NIH_PROJECT_RE = re.compile(
    r"^\d?([A-Z]\d{2}[A-Z]{2,4}\d{6,})(?:-\d+)?$",
    re.I,
)

# Grants.gov / NIH FOA numbers  e.g. RFA-AI-25-001, PA-25-123
_FOA_RE = re.compile(r"^[A-Z]{1,6}-[A-Z]{1,4}-\d{2}-\d{3,}", re.I)

# NSF award IDs: exactly 7 digits
_NSF_AWARD_RE = re.compile(r"^\d{7}$")

# IATI identifiers  e.g. GB-1-123456, US-EIN-123456789
_IATI_RE = re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,10}-.+", re.I)

# ProPublica EIN stored as "EIN: {digits}"
_EIN_RE = re.compile(r"^EIN:\s*(\d{7,})", re.I)

# UUID (UKRI project IDs, 360Giving grant IDs)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)

# Funder prefix patterns — strip variable sub-org suffixes
_FUNDER_PREFIX_MAP = [
    (re.compile(r"^NIH\s*[–\-]", re.I), "NIH"),
    (re.compile(r"^NSF\s*[–\-]", re.I), "NSF"),
    (re.compile(r"^UKRI\s*[–\-]", re.I), "UKRI"),
    (re.compile(r"^EU\s*[–\-]", re.I), "EU"),
    (re.compile(r"^SBIR\s*[–\-]", re.I), "SBIR"),
    (re.compile(r"^USAID\b", re.I), "USAID"),
    (re.compile(r"^Wellcome\b", re.I), "Wellcome"),
    (re.compile(r"^Gates\b", re.I), "Gates"),
    (re.compile(r"^DFID\b|^FCDO\b", re.I), "FCDO"),
]

# Path terminal segments that mean "generic listing", not a specific grant
_GENERIC_PATH_TERMINALS = frozenset({
    "grants", "funding", "funding-opportunities", "opportunities",
    "calls", "apply", "programs", "search", "results", "open-calls",
    "call-for-proposals", "open", "news", "about", "home", "index",
    "ctrack.html",  # IATI d-portal (ID in fragment only)
})

# URL path substrings that confirm a specific grant page
_SPECIFIC_PATH_HINTS = (
    "/project-details/",
    "/search-results-detail/",
    "/topic-details/",
    "/gtr/api/projects/",
    "/grant/",
    "/solicitations/",
    "/nonprofits/organizations/",
)


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def _str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _funder_prefix(funder: str) -> str:
    """Strip variable sub-org suffixes so 'NIH – UCLA' and 'NIH – UCSF' both give 'NIH'."""
    f = _str(funder)
    for pattern, prefix in _FUNDER_PREFIX_MAP:
        if pattern.match(f):
            return prefix.lower()
    return f.lower()


def _normalise_nih(raw: str) -> str | None:
    """Return the base NIH project number without activity-year digit or supplement."""
    m = _NIH_PROJECT_RE.match(raw.strip())
    if m:
        return m.group(1).upper()
    return None


def _extract_external_id(
    program_name: str | None,
    opportunity_number: str | None,
    url: str | None = None,
) -> str | None:
    """Return a normalised external identifier string, or None.

    Checks opportunity_number first, then program_name, then URL path.
    Returned strings are prefixed (e.g. 'nih:', 'eu:', 'nsf:') to avoid
    collisions across sources.
    """
    # opportunity_number takes priority — set explicitly by scraper
    for raw in (_str(opportunity_number), _str(program_name)):
        if not raw:
            continue

        upper = raw.upper()

        # EU  e.g. HORIZON-CL5-2027-07-D3-11
        if _EU_PREFIX_RE.match(upper) and upper.count("-") >= 2:
            return f"eu:{upper}"

        # NIH project number — normalise to base (strip year prefix + supplement)
        nih_base = _normalise_nih(raw)
        if nih_base:
            return f"nih:{nih_base}"

        # Grants.gov / NIH FOA  e.g. RFA-AI-25-001
        if _FOA_RE.match(raw):
            return f"foa:{upper}"

        # NSF 7-digit award ID
        if _NSF_AWARD_RE.match(raw):
            return f"nsf:{raw}"

        # IATI identifier
        if _IATI_RE.match(raw):
            return f"iati:{upper}"

        # ProPublica EIN
        ein = _EIN_RE.match(raw)
        if ein:
            return f"ein:{ein.group(1)}"

        # If opportunity_number was set explicitly (not just program_name fallback)
        # trust it as a generic opaque ID
        if raw == _str(opportunity_number) and raw:
            return f"id:{upper}"

    # UUID in last URL path segment (UKRI, 360Giving)
    if url:
        last_seg = urlparse(url).path.rstrip("/").split("/")[-1]
        if _UUID_RE.match(last_seg):
            return f"uuid:{last_seg.lower()}"

    return None


def _is_specific_url(url: str) -> bool:
    """True only when the URL *path* encodes a grant-specific identifier.

    Returns False when the ID lives only in query params or fragment
    (e.g. NSF ?AWD_ID=..., IATI d-portal #aid=...).
    """
    if not url:
        return False
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")

    if not path or path == "/":
        return False

    path_lower = path.lower()

    # Known specific-path patterns — must have content after the hint
    for hint in _SPECIFIC_PATH_HINTS:
        if hint in path_lower:
            after = path_lower.split(hint)[-1].strip("/")
            if after:
                return True

    # Last segment analysis
    segments = [s for s in path.split("/") if s]
    if not segments:
        return False
    last = segments[-1].lower()

    if last in _GENERIC_PATH_TERMINALS:
        return False
    if _UUID_RE.match(last):
        return True
    # Must be long enough and contain at least one digit to look like a real ID
    if len(last) >= 6 and re.search(r"\d", last):
        return True

    return False


# ---------------------------------------------------------------------------
# In-memory within-run dedup
# ---------------------------------------------------------------------------

def dedup_key(opp: "Opportunity | dict") -> str | None:
    """Return a stable dedup key for within-run deduplication."""
    if isinstance(opp, dict):
        program_name = _str(opp.get("program_name") or opp.get("program"))
        opportunity_number = _str(opp.get("opportunity_number"))
        url = _str(opp.get("opportunity_url") or opp.get("url"))
        title = _str(opp.get("title"))
        funder = _str(opp.get("funder"))
    else:
        program_name = _str(opp.program_name)
        opportunity_number = _str(getattr(opp, "opportunity_number", None))
        url = _str(opp.opportunity_url)
        title = _str(opp.title)
        funder = _str(opp.funder)

    ext_id = _extract_external_id(program_name, opportunity_number, url)
    if ext_id:
        return f"extid:{ext_id}"

    if url and _is_specific_url(url):
        return f"url:{_normalize_url(url)}"

    if title:
        prefix = _funder_prefix(funder)
        return f"title:{title.lower()}|{prefix}"

    return None


def dedup_listings(listings: list[dict]) -> list[dict]:
    """Remove duplicates within a single scraper run; keeps first occurrence."""
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
# DB-level ingest dedup  (Celery worker context, sync SQLAlchemy)
# ---------------------------------------------------------------------------

def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        import dateutil.parser
        return dateutil.parser.parse(str(value)).date()
    except Exception:
        return None


def find_existing_duplicate(
    db: Session,
    listing: dict,
) -> "tuple[Opportunity | None, bool]":
    """Check whether an equivalent opportunity already exists in the DB.

    Returns:
        (existing, is_definitive)

        existing        — matched Opportunity row, or None if no match
        is_definitive   — True  (score ≥ 70) → block ingest
                          False (score 40–69) → caller may ingest with
                                                POSSIBLE_DUPLICATE flag
    """
    call_url = _str(listing.get("url") or listing.get("opportunity_url"))
    program_name = _str(listing.get("program_name") or listing.get("program"))
    opportunity_number = _str(listing.get("opportunity_number"))
    title = _str(listing.get("title"))
    funder = _str(listing.get("funder"))
    source_id = _str(listing.get("source_id"))
    listing_deadline = _parse_date(listing.get("deadline"))

    def _one(stmt):
        return db.execute(stmt).scalar_one_or_none()

    # ── Score 100: External ID ───────────────────────────────────────────────
    # Build the raw lookup values: opportunity_number takes priority, then
    # program_name, then UUID from URL path.
    nih_base = _normalise_nih(opportunity_number or program_name or "")
    raw_lookups: list[str] = []
    if opportunity_number:
        raw_lookups.append(opportunity_number.upper())
    if program_name:
        raw_lookups.append(program_name.upper())
    if nih_base:
        # Also try matching the normalised NIH base against stored values
        raw_lookups.append(nih_base)
    if call_url:
        last_seg = urlparse(call_url).path.rstrip("/").split("/")[-1]
        if _UUID_RE.match(last_seg):
            raw_lookups.append(last_seg.lower())

    if raw_lookups:
        # Deduplicate lookup list while preserving order
        seen_lkp: list[str] = []
        seen_set: set[str] = set()
        for v in raw_lookups:
            if v not in seen_set:
                seen_set.add(v)
                seen_lkp.append(v)

        existing = _one(
            select(Opportunity).where(
                or_(
                    func.upper(Opportunity.opportunity_number).in_(seen_lkp),
                    func.upper(Opportunity.program_name).in_(seen_lkp),
                )
            )
        )
        if existing:
            return existing, True

    # ── Score 80: Specific URL match ─────────────────────────────────────────
    if call_url and _is_specific_url(call_url):
        norm = _normalize_url(call_url)
        existing = _one(
            select(Opportunity).where(
                func.lower(Opportunity.opportunity_url) == norm.lower()
            )
        )
        if existing:
            return existing, True

    # ── Score 70 / 50: Title + funder prefix ─────────────────────────────────
    if title and funder:
        prefix = _funder_prefix(funder)
        candidates = db.execute(
            select(Opportunity).where(
                func.lower(Opportunity.title) == title.lower(),
                func.lower(Opportunity.funder).like(f"{prefix}%"),
                Opportunity.status != "duplicate",
            )
        ).scalars().all()

        if candidates:
            # Score 70: any candidate whose deadline is within 60 days
            if listing_deadline is not None:
                for cand in candidates:
                    if cand.deadline is None or abs((cand.deadline - listing_deadline).days) <= 60:
                        return cand, True
            else:
                # No deadline available — fall through to score 50 behaviour
                return candidates[0], True

            # Score 50: title+prefix matched but deadline outside window
            return candidates[0], False

    # ── Score 30: Title + same source (weakest signal) ───────────────────────
    if title and source_id:
        existing = _one(
            select(Opportunity).where(
                func.lower(Opportunity.title) == title.lower(),
                Opportunity.source_id == source_id,
                Opportunity.status != "duplicate",
            )
        )
        if existing:
            return existing, False

    return None, False
