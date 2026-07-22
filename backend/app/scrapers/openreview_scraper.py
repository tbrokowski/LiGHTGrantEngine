"""
OpenReview conference/workshop scraper (API v2).

OpenReview hosts calls-for-papers for ML/AI/CS conferences and workshops. We
list currently-active venues and surface each as a conference/workshop
opportunity with its submission deadline.

Approach (all read-only, no auth — public reads don't require a token):
  1. GET /groups?id=active_venues  → member list of active venue IDs.
  2. Filter to Conference/Workshop/Symposium venues from year_min onward.
  3. Batch GET /groups?ids=... (chunked)  → each venue group's `content` holds
     title, website, a freeform `date` string (with the submission deadline),
     start_date, and location — all wrapped as {"value": ...} in API v2.
  4. Parse the submission deadline out of the freeform `date` field.

API base: https://api2.openreview.net   Docs: https://docs.openreview.net/
"""
import re
from datetime import date, datetime

import httpx
import structlog

from app.scrapers.base import BaseScraper
from app.scrapers.fetch import BROWSER_HEADERS

logger = structlog.get_logger()

_API_BASE = "https://api2.openreview.net"
_ACTIVE_VENUES_URL = f"{_API_BASE}/groups?id=active_venues"
_GROUPS_URL = f"{_API_BASE}/groups"

# Which venue kinds we treat as opportunities, and how they map to our taxonomy.
_VENUE_KINDS = ("Conference", "Workshop", "Symposium")
_CHUNK = 50  # venue IDs per batch /groups request

# Prefer, in order, whichever deadline label a venue's freeform `date` exposes.
_DEADLINE_LABELS = (
    "Submission Deadline",
    "Paper Submission Deadline",
    "Full Paper Deadline",
    "Abstract Registration",
    "Abstract Deadline",
    "Submission Start",
)
# e.g. "Sep 15 2026 12:00AM UTC-0"  →  captures "Sep 15 2026"
_DATE_RE = re.compile(r"([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})")


def _val(content: dict, key: str) -> str:
    """Read a v2 content field ({"value": ...}) as a plain string."""
    raw = (content or {}).get(key)
    if isinstance(raw, dict):
        raw = raw.get("value")
    return str(raw).strip() if raw not in (None, "") else ""


def _parse_deadline(date_field: str) -> str | None:
    """Extract an ISO date from OpenReview's freeform `date` string, if present."""
    if not date_field:
        return None
    for label in _DEADLINE_LABELS:
        idx = date_field.find(label)
        if idx == -1:
            continue
        m = _DATE_RE.search(date_field, idx)
        if m:
            try:
                dt = datetime.strptime(" ".join(m.groups()), "%b %d %Y")
                return dt.date().isoformat()
            except ValueError:
                continue
    # No labelled deadline — fall back to the first date anywhere in the string.
    m = _DATE_RE.search(date_field)
    if m:
        try:
            return datetime.strptime(" ".join(m.groups()), "%b %d %Y").date().isoformat()
        except ValueError:
            return None
    return None


def _venue_kind(venue_id: str) -> str | None:
    for kind in _VENUE_KINDS:
        if kind in venue_id:
            return kind
    return None


class OpenReviewScraper(BaseScraper):
    """Scraper for OpenReview conference/workshop calls-for-papers (API v2)."""

    def fetch(self) -> list[dict]:
        cfg = self.source.scraper_config or {}
        year_min = int(cfg.get("year_min", date.today().year))
        max_venues = int(cfg.get("max_venues", 150))
        require_deadline = bool(cfg.get("require_deadline", False))

        headers = {**BROWSER_HEADERS, "Accept": "application/json"}
        results: list[dict] = []

        try:
            resp = httpx.get(_ACTIVE_VENUES_URL, timeout=30, headers=headers)
            resp.raise_for_status()
            groups = resp.json().get("groups") or []
            members: list[str] = groups[0].get("members", []) if groups else []
        except Exception as e:
            logger.error("OpenReview: failed to load active_venues", error=str(e))
            return results

        # Keep only recent conference/workshop/symposium venues.
        def _year(vid: str) -> int:
            m = re.search(r"/(20\d\d)(?:/|$)", vid)
            return int(m.group(1)) if m else 0

        candidates = [
            v for v in members if _venue_kind(v) and _year(v) >= year_min
        ]
        # Most recent first, capped.
        candidates.sort(key=_year, reverse=True)
        candidates = candidates[:max_venues]

        for i in range(0, len(candidates), _CHUNK):
            chunk = candidates[i:i + _CHUNK]
            try:
                r = httpx.get(
                    _GROUPS_URL, params={"ids": ",".join(chunk)},
                    timeout=30, headers=headers,
                )
                r.raise_for_status()
                groups = r.json().get("groups") or []
            except Exception as e:
                logger.warning("OpenReview: batch fetch failed", error=str(e))
                continue

            for g in groups:
                vid = g.get("id", "")
                content = g.get("content") or {}
                title = _val(content, "title") or _val(content, "subtitle") or vid
                website = _val(content, "website")
                deadline = _parse_deadline(_val(content, "date"))
                location = _val(content, "location")

                if require_deadline and not deadline:
                    continue

                kind = _venue_kind(vid) or "Conference"
                opp_type = "workshop" if kind == "Workshop" else "conference"

                desc_parts = [f"{kind} on OpenReview."]
                if location:
                    desc_parts.append(f"Location: {location}.")
                if _val(content, "start_date"):
                    desc_parts.append(f"Event date: {_val(content, 'start_date')}.")

                results.append(self._normalize({
                    "title": title,
                    "description": " ".join(desc_parts),
                    "url": website or f"https://openreview.net/group?id={vid}",
                    "funder": "OpenReview",
                    "deadline": deadline,
                    "program_name": vid,
                    "opportunity_number": vid,
                    "opportunity_type": opp_type,
                }))

        logger.info("OpenReview scraper complete", found=len(results))
        return results
