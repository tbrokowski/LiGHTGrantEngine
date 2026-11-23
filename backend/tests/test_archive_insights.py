"""Archive Insights: tag helpers, access checks, and dataset serialization."""
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException

from app.models.archive import GrantArchive
from app.models.user import User
from app.routers.archive_insights import (
    MAX_VIEW_CONFIG_BYTES,
    TAG_PALETTE,
    _require_editor,
    _require_viewer,
    check_color,
    check_view_config,
    clean_text,
    entry_dict,
    next_tag_color,
)


def _user(**kw) -> User:
    base = dict(id="u1", name="Ada", email="ada@example.org", role="viewer",
                institution_id="org-a", institution_role="member",
                module_permissions={"can_view_archive": True})
    return User(**{**base, **kw})


def test_clean_text_collapses_whitespace_and_truncates():
    assert clean_text("  Horizon \n Europe  ", 80) == "Horizon Europe"
    assert clean_text(None, 80) == ""
    assert clean_text("x" * 100, 80) == "x" * 80


def test_tag_colors_fill_the_palette_in_order():
    assert next_tag_color([]) == TAG_PALETTE[0]
    assert next_tag_color([TAG_PALETTE[0]]) == TAG_PALETTE[1]
    # Case-insensitive, and a deleted slot is reused before any slot repeats.
    assert next_tag_color([TAG_PALETTE[0].upper(), TAG_PALETTE[2]]) == TAG_PALETTE[1]
    assert next_tag_color(list(TAG_PALETTE)) == TAG_PALETTE[0]


def test_color_must_be_hex():
    assert check_color("#2A78D6") == "#2a78d6"
    assert check_color(None) is None
    for bad in ("blue", "#fff", "2a78d6", "#2a78d6;"):
        with pytest.raises(HTTPException):
            check_color(bad)


def test_view_config_must_be_a_small_object():
    assert check_view_config({"ids": ["a"]}) == {"ids": ["a"]}
    with pytest.raises(HTTPException):
        check_view_config(["a"])  # type: ignore[arg-type]
    with pytest.raises(HTTPException):
        check_view_config({"ids": ["x" * 100] * (MAX_VIEW_CONFIG_BYTES // 100)})


def test_viewer_needs_archive_access_and_an_org():
    assert _require_viewer(_user()) == "org-a"
    with pytest.raises(HTTPException) as e:
        _require_viewer(_user(module_permissions={"can_view_archive": False}))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        _require_viewer(_user(institution_id=None))
    assert e.value.status_code == 400


def test_only_archive_editors_change_tags():
    with pytest.raises(HTTPException) as e:
        _require_editor(_user())
    assert e.value.status_code == 403
    assert _require_editor(_user(role="grant_lead")) == "org-a"
    assert _require_editor(_user(institution_role="admin")) == "org-a"


def test_entry_dict_serializes_dates_lists_and_tags():
    a = GrantArchive(
        id="a1", title="T", funder="EU", outcome="awarded", call_year=2024,
        submission_date=date(2024, 3, 1), decision_date=date(2024, 9, 15),
        created_at=datetime(2024, 3, 2, tzinfo=timezone.utc),
        requested_amount=100.0, awarded_amount=80.0, currency="EUR",
        themes=None, co_pis=["B"],
    )
    d = entry_dict(a, ["t1", "t2"])
    assert d["submission_date"] == "2024-03-01"
    assert d["decision_date"] == "2024-09-15"
    assert d["created_at"].startswith("2024-03-02")
    assert d["themes"] == [] and d["co_pis"] == ["B"]
    assert d["tag_ids"] == ["t1", "t2"]
    assert "embedding" not in d and "internal_debrief" not in d
