"""Unit tests for the Singapore Research Grants Portal scraper (pure + stubbed HTTP)."""
from datetime import date, timedelta

import pytest

from app.scrapers.apply_gov_sg_scraper import (
    ApplyGovSGScraper,
    _page_text,
    _parse_deadline,
)


# ── deadline parsing ──────────────────────────────────────────────────────────

def test_parses_day_month_year_from_excerpt():
    # The wording the portal actually uses.
    assert _parse_deadline("The 2026 SoL call closes on 6 Nov 2026, 3 pm.") == "2026-11-06"
    assert _parse_deadline("The CRP36 call closes on 9 Nov 2026, 4 PM (SGT).") == "2026-11-09"
    assert _parse_deadline("The call closes on 31 December 2026, 5pm.") == "2026-12-31"


def test_parses_month_day_year():
    assert _parse_deadline("Applications due November 9, 2026.") == "2026-11-09"
    assert _parse_deadline("Submit by Nov 9th, 2026.") == "2026-11-09"


def test_open_until_counts_as_a_deadline_cue():
    # SG-HE states its closing date this way rather than with "closes".
    text = "The call will remain open until 31 Dec 2027 (16:00 SGT)."
    assert _parse_deadline(text) == "2027-12-31"


def test_prefers_cued_sentence_over_unrelated_date():
    text = (
        "The programme was established on 1 Jan 2020. "
        "Awards were announced 5 May 2021. "
        "The call closes on 9 Nov 2026."
    )
    assert _parse_deadline(text) == "2026-11-09"


def test_ignores_past_opening_date_in_favour_of_future_close():
    # "from <past> to <future>" — the future end of the range is the deadline.
    text = "Proposals accepted from 30 Apr 2020 (09:00 SGT) to 31 Dec 2099 (16:00 SGT)."
    assert _parse_deadline(text) == "2099-12-31"


def test_no_date_returns_none():
    assert _parse_deadline("") is None
    assert _parse_deadline("No closing date has been announced.") is None


def test_invalid_calendar_date_returns_none():
    assert _parse_deadline("The call closes on 31 February 2026.") is None


def test_page_text_strips_scripts_and_chrome():
    html = """
    <html><head><style>.a{color:red}</style></head>
      <body><nav>Menu</nav><script>var x=1;</script>
        <p>Grant closes on 9 Nov 2026.</p><footer>Contact us</footer></body></html>
    """
    text = _page_text(html)
    assert "Grant closes on 9 Nov 2026." in text
    assert "var x" not in text and "Menu" not in text and "Contact us" not in text


# ── listing mapping ───────────────────────────────────────────────────────────

class _Source:
    name = "Singapore Research Grants Portal (apply.gov.sg)"
    url = "https://www.apply.gov.sg/grants/research/listing"
    scraper_config: dict = {"follow_details": False}


def _payload(**overrides):
    entry = {
        "id": 2184,
        "name": "36th Competitive Research Programme (CRP36)",
        "has_active_form": True,
        "data": {
            "excerpt": "CRP funds use-inspired basic research. The CRP36 call closes on 9 Nov 2026, 4 PM (SGT).",
            "domain_horizontal": "Academic Research (AR)",
            "grant_administering_agency": "National Research Foundation",
            "website_url": "https://www.rgp.gov.sg/nrf-ar/crp",
            "support_contact_email": "nrf_crp@nrf.gov.sg",
            "support_contact_url": "",
        },
    }
    entry["data"].update(overrides.pop("data", {}))
    entry.update(overrides)
    return {"data": {"lifecycles": [entry], "tag_with_lifecycles": []}}


@pytest.fixture
def stub_get(monkeypatch):
    """Stub httpx.get inside the scraper module with a canned JSON response."""
    def _install(payload, status=200):
        class _Resp:
            def raise_for_status(self):
                if status >= 400:
                    raise RuntimeError(f"HTTP {status}")
            def json(self):
                return payload
        import app.scrapers.apply_gov_sg_scraper as mod
        monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: _Resp())
    return _install


def test_maps_listing_fields(stub_get):
    stub_get(_payload())
    [row] = ApplyGovSGScraper(_Source()).fetch()
    assert row["title"] == "36th Competitive Research Programme (CRP36)"
    assert row["funder"] == "National Research Foundation"
    assert row["url"] == "https://www.rgp.gov.sg/nrf-ar/crp"
    assert row["deadline"] == "2026-11-09"
    assert row["program_name"] == "Academic Research (AR)"
    assert row["opportunity_number"] == "2184"
    assert "nrf_crp@nrf.gov.sg" in row["description"]


def test_requests_json_explicitly(monkeypatch):
    # Load-bearing: without Accept: application/json the SPA route 404s.
    seen = {}
    class _Resp:
        def raise_for_status(self): pass
        def json(self): return _payload()
    import app.scrapers.apply_gov_sg_scraper as mod
    def _get(url, **kw):
        seen.update(kw.get("headers") or {})
        return _Resp()
    monkeypatch.setattr(mod.httpx, "get", _get)
    ApplyGovSGScraper(_Source()).fetch()
    assert seen.get("Accept") == "application/json"


def test_falls_back_to_listing_url_when_no_website(stub_get):
    stub_get(_payload(data={"website_url": "", "support_contact_url": ""}))
    [row] = ApplyGovSGScraper(_Source()).fetch()
    assert row["url"] == _Source.url


def test_skips_closed_grants_by_default(stub_get):
    stub_get(_payload(has_active_form=False))
    assert ApplyGovSGScraper(_Source()).fetch() == []


def test_include_closed_keeps_them(stub_get):
    stub_get(_payload(has_active_form=False))
    src = _Source()
    src.scraper_config = {"follow_details": False, "include_closed": True}
    assert len(ApplyGovSGScraper(src).fetch()) == 1


def test_empty_listing_returns_empty(stub_get):
    stub_get({"data": {"lifecycles": []}})
    assert ApplyGovSGScraper(_Source()).fetch() == []


def test_http_failure_returns_empty_not_raises(stub_get):
    stub_get(_payload(), status=500)
    assert ApplyGovSGScraper(_Source()).fetch() == []


def test_entry_without_name_is_skipped(stub_get):
    stub_get(_payload(name=""))
    assert ApplyGovSGScraper(_Source()).fetch() == []
