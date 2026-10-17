"""Unit tests for the dashboard's daily opportunity picks."""
from datetime import date, datetime, timedelta, timezone

from app.services.daily_picks import (
    Candidate,
    next_refresh,
    picks_day,
    select_daily_picks,
)

NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
TODAY = NOW.date()


def cand(i, funder="F", typ="grant", fit=70, surfaced_days=30, deadline_days=60):
    return Candidate(
        id=f"o{i}",
        funder=funder,
        opportunity_type=typ,
        fit_score=fit,
        surfaced_at=NOW - timedelta(days=surfaced_days),
        deadline=None if deadline_days is None else TODAY + timedelta(days=deadline_days),
    )


def pick(cands, **kw):
    kw.setdefault("day", TODAY)
    kw.setdefault("now", NOW)
    kw.setdefault("seed", "u1")
    return select_daily_picks(cands, **kw)


def test_day_rolls_over_at_picks_hour():
    assert picks_day(datetime(2026, 10, 17, 7, 59, tzinfo=timezone.utc), 8) == date(2026, 10, 16)
    assert picks_day(datetime(2026, 10, 17, 8, 0, tzinfo=timezone.utc), 8) == date(2026, 10, 17)
    assert next_refresh(datetime(2026, 10, 17, 7, 0, tzinfo=timezone.utc), 8) == datetime(
        2026, 10, 17, 8, 0, tzinfo=timezone.utc
    )


def test_drops_closed_and_imminent_deadlines_keeps_rolling():
    cands = [cand(1, deadline_days=-1), cand(2, deadline_days=1), cand(3, deadline_days=None), cand(4)]
    assert set(pick(cands)) == {"o3", "o4"}


def test_funder_and_type_mix():
    cands = [cand(i, funder="Wellcome", fit=95) for i in range(6)]
    cands += [cand(10 + i, funder=f"Funder {i}", typ="fellowship", fit=60) for i in range(6)]
    cands += [cand(20 + i, funder=f"Other {i}", fit=55) for i in range(6)]
    ids = pick(cands, n=10)
    assert len(ids) == 10
    assert sum(1 for i in ids if i in {f"o{k}" for k in range(6)}) <= 2


def test_caps_relax_when_pool_is_small():
    cands = [cand(i, funder="Wellcome") for i in range(5)]
    assert len(pick(cands, n=5)) == 5


def test_recently_featured_held_back_while_others_exist():
    cands = [cand(i, funder=f"F{i}", fit=90 if i < 3 else 60) for i in range(8)]
    ids = pick(cands, n=5, recently_featured={"o0", "o1", "o2"})
    assert not {"o0", "o1", "o2"} & set(ids)


def test_fresh_grants_ranked_ahead_of_similar_older_ones():
    old = [cand(i, funder=f"F{i}", fit=70, surfaced_days=30) for i in range(10)]
    fresh = cand(99, funder="New", fit=70, surfaced_days=0)
    assert pick(old + [fresh], n=3)[0] == "o99"


def test_low_fit_used_only_to_fill():
    cands = [cand(1, fit=80), cand(2, funder="G", fit=10)]
    assert pick(cands, n=1) == ["o1"]
    assert pick(cands, n=2) == ["o1", "o2"]


def test_list_changes_between_days_and_is_stable_within_a_day():
    cands = [cand(i, funder=f"F{i}", fit=70) for i in range(40)]
    a = pick(cands, n=10)
    assert a == pick(cands, n=10)
    b = pick(cands, n=10, day=TODAY + timedelta(days=1), now=NOW + timedelta(days=1))
    assert a != b
