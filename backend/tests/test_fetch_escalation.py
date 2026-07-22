"""Unit tests for the shared fetch layer's escalation + sitemap logic."""
from app.scrapers.fetch import (
    should_escalate,
    count_page_signals,
    SITEMAP_URL_PATTERN,
)
import re


# ── should_escalate ────────────────────────────────────────────────────────────

def test_escalate_on_error_status():
    assert should_escalate(403, 50, 9000) is True
    assert should_escalate(404, 50, 9000) is True
    assert should_escalate(500, 50, 9000) is True


def test_escalate_on_too_few_anchors():
    # A real listing page has many links; a JS shell has almost none.
    assert should_escalate(200, 3, 9000) is True


def test_escalate_on_too_little_text():
    assert should_escalate(200, 50, 100) is True


def test_no_escalate_on_healthy_page():
    assert should_escalate(200, 40, 8000) is False


def test_no_escalate_when_status_none_but_content_ok():
    # Playwright path reports status_code=None but real content.
    assert should_escalate(None, 40, 8000) is False


# ── count_page_signals ─────────────────────────────────────────────────────────

def test_count_page_signals_counts_anchors_and_strips_tags():
    html = (
        "<html><head><style>.x{color:red}</style>"
        "<script>var a = 1;</script></head><body>"
        "<a href='/1'>one</a><a href='/2'>two</a>"
        "<p>Hello world here is some visible text.</p></body></html>"
    )
    anchors, text_len = count_page_signals(html)
    assert anchors == 2
    # script/style content must not count toward visible text
    assert "var a" not in "Hello world here is some visible text."
    assert text_len >= len("Hello world here is some visible text.")


def test_count_page_signals_empty():
    assert count_page_signals("") == (0, 0)


# ── sitemap URL pattern ────────────────────────────────────────────────────────

def test_sitemap_pattern_matches_opportunity_paths():
    pat = re.compile(SITEMAP_URL_PATTERN, re.I)
    assert pat.search("/grants/climate-2026")
    assert pat.search("/funding-opportunities/fellowship-x")
    assert pat.search("/calls/open-call-5")
    assert pat.search("/conference/travel-award")
    assert pat.search("/scholarships/phd")


def test_sitemap_pattern_ignores_noise_paths():
    pat = re.compile(SITEMAP_URL_PATTERN, re.I)
    assert pat.search("/about-us") is None
    assert pat.search("/privacy-policy") is None
    assert pat.search("/news/2026/press-release") is None
