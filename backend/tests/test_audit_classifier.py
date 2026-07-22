"""Unit tests for the audit harness's pure probe classifier."""
import sys
from pathlib import Path

# audit_sources.py lives in scripts/, not on the package path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from audit_sources import classify_probe  # noqa: E402


def _c(**kw):
    base = dict(error=None, status_code=200, redirected=False,
                same_host=True, anchor_count=40, text_chars=8000)
    base.update(kw)
    return classify_probe(**base)


def test_ok_page():
    assert _c() == "ok"


def test_dns_fail():
    assert _c(error="getaddrinfo failed", status_code=None) == "dns_fail"


def test_timeout():
    assert _c(error="Read timed out", status_code=None) == "timeout"


def test_generic_conn_error():
    assert _c(error="Connection reset by peer", status_code=None) == "conn_error"


def test_http_403():
    assert _c(status_code=403) == "http_403"


def test_http_404_and_410():
    assert _c(status_code=404) == "http_404"
    assert _c(status_code=410) == "http_404"


def test_http_other_5xx():
    assert _c(status_code=503) == "http_other"


def test_cross_host_move_is_moved():
    assert _c(redirected=True, same_host=False) == "moved"


def test_same_host_redirect_is_classified_by_content():
    # A same-host redirect that lands on a healthy page is "ok", not "moved".
    assert _c(redirected=True, same_host=True) == "ok"


def test_zero_anchors():
    assert _c(anchor_count=0) == "zero_anchors"


def test_js_required_few_anchors():
    assert _c(anchor_count=5) == "js_required"


def test_js_required_thin_text():
    assert _c(anchor_count=40, text_chars=500) == "js_required"
