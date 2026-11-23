"""Build the Archive CSV export: one row per archived grant with its figures,
tags, notes, and comments.

Pure functions only — the router loads the rows. Output opens cleanly in
Excel, Numbers and Google Sheets: UTF-8 with a BOM, multi-line text kept in
quoted cells, and free text that starts like a formula neutralized so a
spreadsheet never executes it.
"""
import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Optional

# Excel refuses cells longer than 32,767 characters.
MAX_CELL = 32_000

OUTCOME_LABELS = {
    "awarded": "Awarded", "partially_funded": "Partially funded", "rejected": "Rejected",
    "pending": "Pending", "deferred": "Deferred", "withdrawn": "Withdrawn",
    "resubmitted": "Resubmitted", "not_submitted": "Not submitted",
}

COLUMNS = [
    "Title", "Funder", "Programme", "Call year", "Submission cycle", "Outcome",
    "Submission date", "Decision date", "Days to decision",
    "Currency", "Requested", "Awarded", "Odds at submission (%)",
    "Project duration", "Lead PI", "Co-PIs", "Team members", "Partner institutions",
    "Themes", "Geographies", "Tags",
    "Notes", "Lessons learned", "Internal debrief", "Reviewer feedback",
    "Archive comments", "Proposal comments", "Comment count",
    "Repository folder", "Archive link", "Added to archive",
]


@dataclass
class ExportComment:
    created_at: Optional[datetime]
    author: str
    text: str
    is_reply: bool = False
    resolved: bool = False


def csv_safe(value: Any) -> Any:
    """Numbers pass through; text is trimmed to a cell's limit and, if it
    starts like a formula (= + - @, tab, CR), prefixed with ' so spreadsheets
    show it as text instead of running it."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float) and value.is_integer():
        return int(value)  # 2500000, not 2500000.0
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    text = str(value)
    if len(text) > MAX_CELL:
        text = text[: MAX_CELL - 14] + " … (truncated)"
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text
    return text


def join_list(values: Optional[Iterable[Any]]) -> str:
    return "; ".join(str(v).strip() for v in (values or []) if str(v).strip())


def format_comments(comments: list[ExportComment]) -> str:
    """Oldest first, one per line: '2024-03-01 · Ada: text'. Replies are
    indented with ↳; resolved threads are marked."""
    lines = []
    for c in comments:
        when = c.created_at.date().isoformat() if c.created_at else "undated"
        flag = " (resolved)" if c.resolved else ""
        body = " ".join(c.text.split())
        lines.append(f"{'  ↳ ' if c.is_reply else ''}{when} · {c.author}{flag}: {body}")
    return "\n".join(lines)


def tag_label(name: str, group: str) -> str:
    return f"{group}: {name}" if group else name


def days_between(start: Optional[date], end: Optional[date]) -> Optional[int]:
    if not start or not end:
        return None
    d = (end - start).days
    return d if d >= 0 else None


def export_row(
    a: Any,
    tags: list[str],
    archive_comments: list[ExportComment],
    proposal_comments: list[ExportComment],
    archive_url: str,
) -> list[Any]:
    """One CSV row for an archived grant (`a` is a GrantArchive or alike)."""
    row = [
        a.title, a.funder, a.program, a.call_year, a.submission_cycle,
        OUTCOME_LABELS.get(a.outcome or "", a.outcome),
        a.submission_date, a.decision_date, days_between(a.submission_date, a.decision_date),
        (a.currency or "").upper() or None, a.requested_amount, a.awarded_amount, a.win_confidence,
        a.project_duration, a.lead_pi, join_list(a.co_pis), join_list(a.team_members),
        join_list(a.partner_institutions), join_list(a.themes), join_list(a.geographies),
        "; ".join(tags),
        a.notes, a.lessons_learned, a.internal_debrief, a.reviewer_feedback,
        format_comments(archive_comments), format_comments(proposal_comments),
        len(archive_comments) + len(proposal_comments),
        a.repository_folder_url, archive_url, a.created_at,
    ]
    return [csv_safe(v) for v in row]


def to_csv(rows: list[list[Any]]) -> str:
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel reads UTF-8 (accents, €, …)
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    writer.writerows(rows)
    return buf.getvalue()
