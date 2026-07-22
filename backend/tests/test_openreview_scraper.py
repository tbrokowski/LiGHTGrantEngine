"""Unit tests for OpenReview deadline parsing + venue classification (pure)."""
from app.scrapers.openreview_scraper import _parse_deadline, _venue_kind, _val


def test_parse_labelled_submission_deadline():
    assert _parse_deadline("Submission Deadline: Sep 15 2026 12:00AM UTC-0") == "2026-09-15"


def test_parse_prefers_deadline_over_submission_start():
    # "Submission Start" is when submissions OPEN, not a deadline — a real
    # deadline label must win even when it appears later in the string.
    s = "Submission Start: Feb 28 2026 11:59PM, Abstract Registration: May 23 2026 02:00PM"
    assert _parse_deadline(s) == "2026-05-23"


def test_parse_tbd_returns_none():
    assert _parse_deadline("Submission Deadline: TBD") is None


def test_parse_empty_returns_none():
    assert _parse_deadline("") is None
    assert _parse_deadline("no dates here at all") is None


def test_parse_unlabelled_date_fallback():
    # No recognised label, but a bare date is present → use it.
    assert _parse_deadline("Important: Mar 09 2027 deadline") == "2027-03-09"


def test_parse_invalid_date_returns_none():
    assert _parse_deadline("Submission Deadline: Foo 99 2026") is None


def test_venue_kind_classification():
    assert _venue_kind("PGM/2026/Conference") == "Conference"
    assert _venue_kind("ICML.cc/2026/Workshop/XYZ") == "Workshop"
    assert _venue_kind("Some/2026/Symposium") == "Symposium"
    assert _venue_kind("TMLR") is None


def test_val_unwraps_v2_content():
    content = {"title": {"value": "AAAI 2026"}, "empty": {"value": ""}, "plain": "x"}
    assert _val(content, "title") == "AAAI 2026"
    assert _val(content, "empty") == ""
    assert _val(content, "plain") == "x"
    assert _val(content, "missing") == ""
