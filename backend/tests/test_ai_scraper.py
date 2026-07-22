"""
Unit tests for the AIScraper pagination + crawl_depth=1 detail-page crawling.

Regression coverage for a bug where, when a source had both `paginate: true`
and `crawl_depth: 1` configured (e.g. multi-page grant listing portals),
depth-1 detail-link candidates were only ever drawn from the first listing
page — pages discovered via pagination were fetched for listing text but
their links were never eligible for the "click into an individual grant"
follow-through.
"""
from types import SimpleNamespace

import pytest
from bs4 import BeautifulSoup

from app.scrapers import ai_scraper
from app.scrapers.ai_scraper import AIScraper, _detect_next_page, probe_pagination


# ── _detect_next_page ────────────────────────────────────────────────────────

def test_detect_next_page_rel_next_link_tag():
    soup = BeautifulSoup(
        '<html><head><link rel="next" href="/grants?page=2"></head></html>', "lxml"
    )
    assert _detect_next_page(soup, "https://example.com/grants") == "https://example.com/grants?page=2"


def test_detect_next_page_anchor_text():
    soup = BeautifulSoup(
        '<html><body><a href="/grants?p=2">Next</a></body></html>', "lxml"
    )
    assert _detect_next_page(soup, "https://example.com/grants") == "https://example.com/grants?p=2"


def test_detect_next_page_query_pattern():
    soup = BeautifulSoup(
        '<html><body>'
        '<a href="/grants?page=2">2</a>'
        '<a href="/grants?page=3">3</a>'
        '</body></html>', "lxml"
    )
    assert _detect_next_page(soup, "https://example.com/grants?page=1") == "https://example.com/grants?page=2"


def test_detect_next_page_pretty_url_pattern():
    soup = BeautifulSoup(
        '<html><body><a href="/grants/page/2/">2</a></body></html>', "lxml"
    )
    assert _detect_next_page(soup, "https://example.com/grants/page/1/") == "https://example.com/grants/page/2/"


def test_detect_next_page_none_when_no_pagination():
    soup = BeautifulSoup('<html><body><a href="/about">About</a></body></html>', "lxml")
    assert _detect_next_page(soup, "https://example.com/grants") is None


# ── probe_pagination ─────────────────────────────────────────────────────────

def _fake_page(html: str):
    """Stand-in for app.scrapers.fetch.FetchResult with just what callers read."""
    return SimpleNamespace(html=html, status_code=200 if html else None,
                           final_url="", method_used="httpx", escalated=False,
                           error=None, anchor_count=html.count("<a "), text_chars=len(html),
                           redirected=False, ok=bool(html))


def test_probe_pagination_detects_numbered_pages(monkeypatch):
    html = "<html><body>" + "".join(
        f'<a href="https://example.com/opportunity/?page={n}">Page {n}</a>' for n in range(1, 14)
    ) + "</body></html>"

    monkeypatch.setattr("app.scrapers.fetch.fetch_page", lambda url, **kw: _fake_page(html))

    result = probe_pagination("https://example.com/opportunity/", use_playwright=False)
    assert result["paginate"] is True
    assert result["max_pages"] == 13


def test_probe_pagination_single_page(monkeypatch):
    html = "<html><body><a href='/about'>About</a></body></html>"
    monkeypatch.setattr("app.scrapers.fetch.fetch_page", lambda url, **kw: _fake_page(html))

    result = probe_pagination("https://example.com/grants", use_playwright=False)
    assert result["paginate"] is False


def test_probe_pagination_network_failure_falls_back(monkeypatch):
    def _raise(url, **kw):
        raise ConnectionError("boom")

    monkeypatch.setattr("app.scrapers.fetch.fetch_page", _raise)
    result = probe_pagination("https://example.com/grants")
    assert result == {"paginate": False, "max_pages": 20}


# ── AIScraper.fetch(): crawl_depth composes with pagination ────────────────

def test_depth1_candidates_span_all_paginated_pages(monkeypatch):
    """
    Regression test: with paginate=True and crawl_depth=1, detail links must
    be followed on every listing page reached via pagination, not just the
    first. Also verifies an opportunity URL already resolved from listing-page
    extraction is not re-fetched as a "detail" page.
    """
    base = "https://example.com/grants"
    page2 = f"{base}?page=2"
    page3 = f"{base}?page=3"

    listing_links = {
        base: [("Detail 1 anchor", f"{base}/detail-1")],
        page2: [("Detail 2 anchor", f"{base}/detail-2")],
        page3: [("Detail 3 anchor", f"{base}/detail-3")],
    }
    raw_html_for_pagination = {
        base: f'<html><body><a rel="next" href="{page2}">Next</a></body></html>',
        page2: f'<html><body><a rel="next" href="{page3}">Next</a></body></html>',
        page3: "<html><body>No more pages</body></html>",
    }

    fetch_calls: list[str] = []

    def fake_fetch_page_text(url, use_playwright):
        fetch_calls.append(url)
        if url in listing_links:
            return f"LISTING:{url}", listing_links[url]
        return f"DETAIL:{url}", []

    async def fake_llm_extract(text, source_name, page_links=None):
        if text == f"LISTING:{base}":
            # This page's own listing extraction already resolved detail-1 —
            # it must NOT be re-visited as a depth-1 detail-page candidate.
            return [{"title": "Already resolved grant", "url": f"{base}/detail-1", "funder": source_name}]
        if text.startswith("LISTING:"):
            return []
        if text.startswith("DETAIL:"):
            detail_url = text[len("DETAIL:"):]
            return [{"title": f"Grant at {detail_url}", "url": detail_url, "funder": source_name}]
        return []

    monkeypatch.setattr(ai_scraper, "_fetch_page_text", fake_fetch_page_text)
    monkeypatch.setattr(ai_scraper, "_llm_extract", fake_llm_extract)
    monkeypatch.setattr(
        "app.scrapers.fetch.fetch_page",
        lambda url, **kw: _fake_page(raw_html_for_pagination[url]),
    )

    source = SimpleNamespace(
        url=base,
        name="Test Source",
        scraper_config={
            "use_playwright": False,
            "crawl_depth": 1,
            "paginate": True,
            "max_pages": 3,
            "max_detail_links": 40,
        },
    )

    results = AIScraper(source).fetch()
    urls = {r["url"] for r in results}

    assert urls == {f"{base}/detail-1", f"{base}/detail-2", f"{base}/detail-3"}
    # detail-1 was already resolved via listing extraction — it must never be
    # fetched again as a standalone detail page.
    assert fetch_calls.count(f"{base}/detail-1") == 0
    # detail-2 and detail-3 live on pages 2 and 3 — proving depth-1 candidates
    # were drawn from every paginated page, not just the first.
    assert fetch_calls.count(f"{base}/detail-2") == 1
    assert fetch_calls.count(f"{base}/detail-3") == 1


def test_max_detail_links_caps_across_whole_run_not_per_page(monkeypatch):
    base = "https://example.com/grants"
    page2 = f"{base}?page=2"

    listing_links = {
        base: [(f"D{i}", f"{base}/d{i}") for i in range(5)],
        page2: [(f"D{i}", f"{base}/d{i}") for i in range(5, 10)],
    }
    raw_html_for_pagination = {
        base: f'<html><body><a rel="next" href="{page2}">Next</a></body></html>',
        page2: "<html><body>No more pages</body></html>",
    }

    def fake_fetch_page_text(url, use_playwright):
        if url in listing_links:
            return f"LISTING:{url}", listing_links[url]
        return f"DETAIL:{url}", []

    async def fake_llm_extract(text, source_name, page_links=None):
        if text.startswith("LISTING:"):
            return []
        if text.startswith("DETAIL:"):
            detail_url = text[len("DETAIL:"):]
            return [{"title": f"Grant at {detail_url}", "url": detail_url, "funder": source_name}]
        return []

    monkeypatch.setattr(ai_scraper, "_fetch_page_text", fake_fetch_page_text)
    monkeypatch.setattr(ai_scraper, "_llm_extract", fake_llm_extract)
    monkeypatch.setattr(
        "app.scrapers.fetch.fetch_page",
        lambda url, **kw: _fake_page(raw_html_for_pagination[url]),
    )

    source = SimpleNamespace(
        url=base,
        name="Test Source",
        scraper_config={
            "use_playwright": False,
            "crawl_depth": 1,
            "paginate": True,
            "max_pages": 5,
            "max_detail_links": 3,
        },
    )

    results = AIScraper(source).fetch()
    # Run-wide cap of 3 applies across both pages combined, not 3-per-page.
    assert len(results) == 3
