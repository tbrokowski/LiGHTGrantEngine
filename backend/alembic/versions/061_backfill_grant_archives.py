"""Backfill archive entries for grants that moved past 'proposal' without one.

Only the stage-transition modal (PATCH /grants/{id}/stage) ever wrote a
GrantArchive row. The workspace status dropdown PATCHes `status` directly, and
migration 047 taught that path to keep `grant_stage` in sync — so those grants
left the Proposals tab and looked submitted, but no archive entry was ever
created for them. The API now creates one from either path; this backfills the
rows that slipped through in the meantime.

For each grant past 'proposal' with no archive entry, this writes the same
snapshot `_upsert_grant_archive` would have. Where the workspace holds proposal
text, it also writes the FULL_PROPOSAL document and leaves indexing_status =
'pending', which the archive worker's stale-pending watchdog picks up within
minutes — no Celery broker needed at migration time. Grants with an empty
workspace get a metadata-only entry marked 'complete': there is nothing to
index, and 'pending' would only produce a failed indexing run.
"""
import json
import re
import uuid
from html import unescape

from alembic import op
import sqlalchemy as sa

# Kept under 32 characters: alembic_version.version_num is varchar(32).
revision = "061_backfill_grant_archives"
down_revision = "060_graph_snapshots"
branch_labels = None
depends_on = None

# Mirrors STATUS_TO_ARCHIVE_OUTCOME in app/routers/grants.py, frozen here so a
# later change to that map cannot retroactively alter this migration.
STATUS_TO_OUTCOME = {
    "awarded": "awarded",
    "rejected": "rejected",
    "submitted": "pending",
    "under_review": "pending",
    "withdrawn": "withdrawn",
    "deferred": "deferred",
}
SUBMITTED_STATUSES = {"submitted", "under_review", "awarded", "rejected"}
BACKFILL_STAGES = ("pending", "active", "rejected", "archived")
SNAPSHOT_FILENAME = "workspace_proposal.txt"


def _strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return unescape(re.sub(r"\s+", " ", text)).strip()


def _as_obj(value):
    """JSON columns come back as str on some drivers and as dict/list on others."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _proposal_text(editor_document, editor_sections) -> str:
    if editor_document:
        return _strip_html(editor_document)
    sections = _as_obj(editor_sections) or {}
    if not isinstance(sections, dict):
        return ""
    parts = []
    for sec in sorted(sections.values(), key=lambda s: (s or {}).get("order", 0)):
        if not isinstance(sec, dict):
            continue
        text = sec.get("content_text") or _strip_html(sec.get("content_html", ""))
        if text and text.strip():
            parts.append(text.strip())
    return "\n\n".join(parts)


def _outcome_for(status: str, stage: str) -> str:
    mapped = STATUS_TO_OUTCOME.get(status)
    if mapped:
        return mapped
    # 'closed' and anything else unmapped: an award that ran its course is
    # 'awarded'; a grant closed before a decision never had one.
    return "awarded" if stage == "active" else "pending"


def upgrade() -> None:
    conn = op.get_bind()

    grants = conn.execute(
        sa.text(
            """
            SELECT g.id, g.opportunity_id, g.title, g.funder, g.program, g.pi_name,
                   g.co_pis, g.proposal_team, g.partner_institutions,
                   g.themes, g.geographies, g.status, g.grant_stage,
                   g.requested_amount, g.award_amount, g.currency, g.project_duration,
                   g.drive_folder_url, g.final_package_url, g.notes,
                   g.editor_document, g.editor_sections
            FROM active_grants g
            LEFT JOIN grant_archives a ON a.grant_id = g.id
            WHERE a.id IS NULL
              AND g.grant_stage IN :stages
            """
        ).bindparams(sa.bindparam("stages", expanding=True)),
        {"stages": list(BACKFILL_STAGES)},
    ).mappings().all()

    for g in grants:
        text = _proposal_text(g["editor_document"], g["editor_sections"])
        archive_id = str(uuid.uuid4())

        conn.execute(
            sa.text(
                """
                INSERT INTO grant_archives (
                    id, grant_id, opportunity_id, title, funder, program, lead_pi,
                    co_pis, team_members, partner_institutions, themes, geographies,
                    submitted, outcome, requested_amount, awarded_amount, currency,
                    project_duration, repository_folder_url, notes,
                    access_level, ai_retrieval_allowed, text_reuse_allowed,
                    indexing_status, document_structure, style_fingerprint,
                    created_at, updated_at
                ) VALUES (
                    :id, :grant_id, :opportunity_id, :title, :funder, :program, :lead_pi,
                    CAST(:co_pis AS json), CAST(:team_members AS json),
                    CAST(:partner_institutions AS json),
                    CAST(:themes AS json), CAST(:geographies AS json),
                    :submitted, :outcome, :requested_amount, :awarded_amount, :currency,
                    :project_duration, :repository_folder_url, :notes,
                    'team_only', true, false,
                    :indexing_status, CAST('[]' AS json), CAST('{}' AS json),
                    NOW(), NOW()
                )
                """
            ),
            {
                "id": archive_id,
                "grant_id": g["id"],
                "opportunity_id": g["opportunity_id"],
                "title": g["title"],
                "funder": g["funder"],
                "program": g["program"],
                "lead_pi": g["pi_name"],
                "co_pis": json.dumps(_as_obj(g["co_pis"]) or []),
                "team_members": json.dumps(_as_obj(g["proposal_team"]) or []),
                "partner_institutions": json.dumps(_as_obj(g["partner_institutions"]) or []),
                "themes": json.dumps(_as_obj(g["themes"]) or []),
                "geographies": json.dumps(_as_obj(g["geographies"]) or []),
                "submitted": g["status"] in SUBMITTED_STATUSES,
                "outcome": _outcome_for(g["status"], g["grant_stage"]),
                "requested_amount": g["requested_amount"],
                "awarded_amount": g["award_amount"],
                "currency": g["currency"],
                "project_duration": g["project_duration"],
                "repository_folder_url": g["drive_folder_url"] or g["final_package_url"],
                "notes": g["notes"],
                "indexing_status": "pending" if text.strip() else "complete",
            },
        )

        if text.strip():
            conn.execute(
                sa.text(
                    """
                    INSERT INTO documents (
                        id, grant_id, archive_id, document_type, file_name,
                        parsed_text, processing_status, uploaded_at,
                        access_level, ai_retrieval_allowed, text_reuse_allowed
                    ) VALUES (
                        :id, :grant_id, :archive_id, 'full_proposal', :file_name,
                        :parsed_text, 'processed', NOW(),
                        'team_only', true, false
                    )
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "grant_id": g["id"],
                    "archive_id": archive_id,
                    "file_name": SNAPSHOT_FILENAME,
                    "parsed_text": text,
                },
            )


def downgrade() -> None:
    # The backfilled rows are indistinguishable from ones the app would have
    # created, and dropping them would take real archive history with them.
    pass
