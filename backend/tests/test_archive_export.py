"""Archive CSV export: cell safety, comment formatting, and a full round trip."""
import csv
import io
from datetime import date, datetime, timezone

from app.models.archive import GrantArchive
from app.services.archive_export import (
    COLUMNS, MAX_CELL, ExportComment, csv_safe, export_row, format_comments, tag_label, to_csv,
)


def test_formula_like_text_is_neutralized():
    for risky in ("=HYPERLINK(\"x\")", "+1", "-cmd", "@SUM(A1)", "\tx"):
        assert csv_safe(risky).startswith("'")
    assert csv_safe("Plain note") == "Plain note"
    # Real numbers stay numbers, negative ones included.
    assert csv_safe(-1200.5) == -1200.5
    assert csv_safe(0) == 0
    assert csv_safe(2_500_000.0) == 2_500_000 and isinstance(csv_safe(2_500_000.0), int)


def test_cells_are_trimmed_to_spreadsheet_limits():
    out = csv_safe("x" * (MAX_CELL + 500))
    assert len(out) <= MAX_CELL and out.endswith("(truncated)")


def test_values_render_plainly():
    assert csv_safe(None) == ""
    assert csv_safe(True) == "Yes"
    assert csv_safe(date(2024, 3, 1)) == "2024-03-01"
    assert csv_safe(datetime(2024, 3, 1, 9, 30, tzinfo=timezone.utc)) == "2024-03-01"
    assert tag_label("EOI", "Stage") == "Stage: EOI" and tag_label("Misc", "") == "Misc"


def test_comments_read_as_a_thread():
    text = format_comments([
        ExportComment(datetime(2024, 1, 2, tzinfo=timezone.utc), "Ada", "Tighten\n the aims"),
        ExportComment(datetime(2024, 1, 3, tzinfo=timezone.utc), "Ben", "Done", is_reply=True, resolved=True),
        ExportComment(None, "AI reviewer", "Budget unclear"),
    ])
    assert text.splitlines() == [
        "2024-01-02 · Ada: Tighten the aims",
        "  ↳ 2024-01-03 · Ben (resolved): Done",
        "undated · AI reviewer: Budget unclear",
    ]


def test_row_round_trips_through_a_csv_reader():
    a = GrantArchive(
        id="a1", title="AI triage, rural clinics", funder="European Commission", program="Horizon Europe",
        call_year=2024, outcome="partially_funded", currency="eur",
        submission_date=date(2024, 1, 10), decision_date=date(2024, 7, 9),
        requested_amount=2_500_000.0, awarded_amount=1_900_000.0, win_confidence=30,
        co_pis=["B. Chen", "C. Otieno"], themes=["digital health"], team_members=[], partner_institutions=[],
        geographies=["Kenya"], notes="Line one\nLine two, with \"quotes\"", lessons_learned="=risky",
        created_at=datetime(2024, 8, 1, tzinfo=timezone.utc),
    )
    row = export_row(a, ["Stage: EOI"], [ExportComment(None, "Ada", "Nice")], [], "https://app/archive/a1")
    assert len(row) == len(COLUMNS)

    text = to_csv([row])
    assert text.startswith("﻿")
    parsed = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    header, values = parsed[0], dict(zip(parsed[0], parsed[1]))
    assert header == COLUMNS
    assert values["Outcome"] == "Partially funded"
    assert values["Currency"] == "EUR"
    assert values["Requested"] == "2500000"
    assert values["Days to decision"] == "181"
    assert values["Odds at submission (%)"] == "30"
    assert values["Co-PIs"] == "B. Chen; C. Otieno"
    assert values["Tags"] == "Stage: EOI"
    assert values["Notes"] == "Line one\nLine two, with \"quotes\""
    assert values["Lessons learned"] == "'=risky"
    assert values["Archive comments"] == "undated · Ada: Nice"
    assert values["Comment count"] == "1"
    assert values["Archive link"] == "https://app/archive/a1"
