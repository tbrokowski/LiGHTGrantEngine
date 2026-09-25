"""Unit tests for adding partners to groups by tag."""
from app.services.partner_groups import tag_matches


def test_any_match_is_case_insensitive():
    assert tag_matches(["Pediatrics", "TB"], ["pediatrics"]) == ["pediatrics"]


def test_any_match_returns_only_hits():
    assert tag_matches(["ultrasound"], ["ultrasound", "TB"]) == ["ultrasound"]


def test_all_requires_every_tag():
    assert tag_matches(["epidemiology"], ["epidemiology", "malaria"], "all") == []
    assert tag_matches(["malaria", "Epidemiology"], ["epidemiology", "malaria"], "all") == ["epidemiology", "malaria"]


def test_no_tags():
    assert tag_matches(None, ["x"]) == []
    assert tag_matches([], ["x"], "all") == []
