"""Daily opportunity picks — the dashboard's "Today's Opportunities" list.

Each user gets one fixed list per "picks day". The day rolls over at
``discovery.daily_picks_hour`` (UTC), set a couple of hours after the daily
source scan so a fresh day's list includes what that scan found.

Selection, from the user's relevance-ranked institution feed:
  * hard filters — still open (deadline far enough out or rolling), not
    rejected/archived/awarded, not already read before today;
  * ranking — org fit score, a bonus for recently surfaced grants, and a small
    per-user/per-day jitter so near-ties rotate from day to day;
  * no repeats — anything featured in the last ``REPEAT_WINDOW_DAYS`` days is
    held back while enough other candidates exist;
  * mix — at most ``MAX_PER_FUNDER`` per funder and ``MAX_PER_TYPE`` per
    opportunity type, relaxed only if the pool is too small to fill the list.

The pure selection lives in :func:`select_daily_picks` so it can be tested
without a database or Redis.
"""
from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

DEFAULT_PICKS = 10
DEFAULT_PICKS_HOUR = 8          # UTC; daily scan runs at 06:00 by default
MIN_FIT = 40                    # matches discovery.auto_queue_threshold
MIN_DAYS_TO_DEADLINE = 3        # anything closing sooner is not actionable
REPEAT_WINDOW_DAYS = 14
MAX_PER_FUNDER = 2
MAX_PER_TYPE = 5
FRESH_BONUS = ((2, 15.0), (7, 8.0))   # (surfaced within N days, bonus points)
JITTER_POINTS = 10.0
EXCLUDED_STATUSES = {"rejected", "archived", "duplicate"}


@dataclass(frozen=True)
class Candidate:
    id: str
    funder: str | None
    opportunity_type: str | None
    fit_score: float | None
    surfaced_at: datetime | None
    deadline: date | None


def picks_day(now: datetime, picks_hour: int = DEFAULT_PICKS_HOUR) -> date:
    """The calendar date whose list is current at ``now`` (UTC)."""
    now = now.astimezone(timezone.utc)
    return (now - timedelta(hours=picks_hour)).date()


def next_refresh(now: datetime, picks_hour: int = DEFAULT_PICKS_HOUR) -> datetime:
    day = picks_day(now, picks_hour) + timedelta(days=1)
    return datetime.combine(day, time(hour=picks_hour), tzinfo=timezone.utc)


def _jitter(seed: str, opp_id: str) -> float:
    h = hashlib.sha256(f"{seed}:{opp_id}".encode()).digest()
    return int.from_bytes(h[:4], "big") / 0xFFFFFFFF * JITTER_POINTS


def _funder_key(funder: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (funder or "").lower()).strip() or "unknown"


def is_fresh(c: Candidate, now: datetime, days: int = 2) -> bool:
    return bool(c.surfaced_at and now - c.surfaced_at <= timedelta(days=days))


def _score(c: Candidate, now: datetime, seed: str) -> float:
    score = float(c.fit_score or 0)
    if c.surfaced_at:
        age = now - c.surfaced_at
        for days, bonus in FRESH_BONUS:
            if age <= timedelta(days=days):
                score += bonus
                break
    return score + _jitter(seed, c.id)


def select_daily_picks(
    candidates: list[Candidate],
    *,
    day: date,
    now: datetime,
    seed: str,
    recently_featured: set[str] = frozenset(),
    n: int = DEFAULT_PICKS,
) -> list[str]:
    """Return up to ``n`` opportunity ids for ``day``, best first."""
    cutoff = day + timedelta(days=MIN_DAYS_TO_DEADLINE)
    open_ = [c for c in candidates if c.deadline is None or c.deadline >= cutoff]
    day_seed = f"{seed}:{day.isoformat()}"
    ranked = sorted(open_, key=lambda c: _score(c, now, day_seed), reverse=True)

    relevant = [c for c in ranked if (c.fit_score or 0) >= MIN_FIT]
    # Tiers in order of preference; a later tier is used only to fill gaps.
    tiers = [
        [c for c in relevant if c.id not in recently_featured],
        [c for c in relevant if c.id in recently_featured],
        [c for c in ranked if (c.fit_score or 0) < MIN_FIT],
    ]

    picked: list[Candidate] = []
    picked_ids: set[str] = set()
    per_funder: dict[str, int] = {}
    per_type: dict[str, int] = {}

    def take(c: Candidate) -> None:
        picked.append(c)
        picked_ids.add(c.id)
        fk = _funder_key(c.funder)
        tk = c.opportunity_type or "other"
        per_funder[fk] = per_funder.get(fk, 0) + 1
        per_type[tk] = per_type.get(tk, 0) + 1

    for tier in tiers:
        # First with the mix caps, then without, before dropping to the next tier.
        for capped in (True, False):
            for c in tier:
                if len(picked) >= n:
                    return [p.id for p in picked]
                if c.id in picked_ids:
                    continue
                if capped and (
                    per_funder.get(_funder_key(c.funder), 0) >= MAX_PER_FUNDER
                    or per_type.get(c.opportunity_type or "other", 0) >= max(MAX_PER_TYPE, math.ceil(n / 2))
                ):
                    continue
                take(c)
    return [p.id for p in picked]
