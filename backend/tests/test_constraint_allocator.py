"""Unit tests for constraint_allocator."""
import pytest

from app.ai.services.constraint_allocator import (
    allocate_section_budgets,
    audit_constraints_compliance,
    parse_int_limit,
    resolve_total_words,
)


def test_parse_int_limit():
    assert parse_int_limit("70 pages") == 70
    assert parse_int_limit("15,000 words") == 15000
    assert parse_int_limit(5000) == 5000


def test_resolve_total_words_explicit():
    total, method = resolve_total_words(25000, "70 pages")
    assert total == 25000
    assert method == "explicit_word_limit"


def test_resolve_total_words_from_pages():
    total, method = resolve_total_words(None, "70 pages")
    assert total == 35000
    assert method == "pages_x_wpp"


def test_resolve_total_words_narrative_pages():
    total, _ = resolve_total_words(None, "70", narrative_page_limit=25)
    assert total == 12500


def test_allocate_renormalizes():
    sections = [
        {"name": "Introduction", "priority": "medium", "order": 1},
        {"name": "Methods", "priority": "high", "order": 2},
        {"name": "Impact", "priority": "high", "order": 3},
    ]
    out = allocate_section_budgets(sections, 9000)
    assert len(out) == 3
    assert all(s["word_limit"] >= 400 for s in out)
    total = sum(s["word_limit"] for s in out)
    assert abs(total - 9000) <= 9000 * 0.02 + 10


def test_audit_sum_mismatch():
    dc = {
        "total_word_limit": 10000,
        "sections": [
            {"name": "A", "word_limit": 100},
            {"name": "B", "word_limit": 100},
        ],
    }
    result = audit_constraints_compliance(dc)
    assert not result["passed"]
    assert any("sum" in i.lower() for i in result["issues"])
