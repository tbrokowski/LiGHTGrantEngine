"""CRM overhaul — organizations, meetings, documents, reminders, enrichment fields.

Revision ID: 033
Revises: 032
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── partner_organizations ──────────────────────────────────────────────────
    op.create_table(
        "partner_organizations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("org_type", sa.String(50), default="other"),
        sa.Column("website", sa.String(1000)),
        sa.Column("domain", sa.String(200)),
        sa.Column("country", sa.String(100)),
        sa.Column("city", sa.String(100)),
        sa.Column("description", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("tags", sa.JSON(), default=[]),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_organizations_name", "partner_organizations", ["name"])
    op.create_index("ix_partner_organizations_institution_id", "partner_organizations", ["institution_id"])

    # ── ALTER partners — add new CRM enrichment fields ─────────────────────────
    op.add_column("partners", sa.Column("organization_id", sa.String(), sa.ForeignKey("partner_organizations.id"), nullable=True))
    op.add_column("partners", sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=True))
    op.add_column("partners", sa.Column("orcid", sa.String(100), nullable=True))
    op.add_column("partners", sa.Column("google_scholar_id", sa.String(200), nullable=True))
    op.add_column("partners", sa.Column("h_index", sa.Integer(), nullable=True))
    op.add_column("partners", sa.Column("expertise_embedding", Vector(1536), nullable=True))
    op.add_column("partners", sa.Column("relationship_stage", sa.String(50), server_default="prospect"))
    op.add_column("partners", sa.Column("avatar_url", sa.String(1000), nullable=True))
    op.add_column("partners", sa.Column("department", sa.String(200), nullable=True))
    op.add_column("partners", sa.Column("country", sa.String(100), nullable=True))
    op.add_column("partners", sa.Column("city", sa.String(100), nullable=True))
    op.add_column("partners", sa.Column("last_enriched_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("partners", sa.Column("enrichment_source", sa.String(200), nullable=True))
    op.add_column("partners", sa.Column("enrichment_status", sa.String(50), server_default="none"))
    op.create_index("ix_partners_institution_id", "partners", ["institution_id"])
    op.create_index("ix_partners_organization_id", "partners", ["organization_id"])
    op.create_index("ix_partners_relationship_stage", "partners", ["relationship_stage"])

    # ── partner_meetings ────────────────────────────────────────────────────────
    op.create_table(
        "partner_meetings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True)),
        sa.Column("duration_minutes", sa.Integer(), default=60),
        sa.Column("location", sa.String(500)),
        sa.Column("meeting_type", sa.String(50), default="video"),
        sa.Column("agenda", sa.JSON(), default=[]),
        sa.Column("notes", sa.Text()),
        sa.Column("action_items", sa.JSON(), default=[]),
        sa.Column("attendees", sa.JSON(), default=[]),
        sa.Column("grant_context_entity_type", sa.String(50)),
        sa.Column("grant_context_entity_id", sa.String()),
        sa.Column("meeting_prep", sa.Text()),
        sa.Column("meeting_prep_generated_at", sa.DateTime(timezone=True)),
        sa.Column("reminder_at", sa.DateTime(timezone=True)),
        sa.Column("reminder_sent", sa.Boolean(), default=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_meetings_partner_id", "partner_meetings", ["partner_id"])
    op.create_index("ix_partner_meetings_scheduled_at", "partner_meetings", ["scheduled_at"])
    op.create_index("ix_partner_meetings_institution_id", "partner_meetings", ["institution_id"])

    # ── partner_documents ───────────────────────────────────────────────────────
    op.create_table(
        "partner_documents",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=False),
        sa.Column("document_type", sa.String(50), default="cv"),
        sa.Column("filename", sa.String(500)),
        sa.Column("file_url", sa.String(1000)),
        sa.Column("file_size", sa.Integer()),
        sa.Column("parsed_text", sa.Text()),
        sa.Column("expertise_extracted", sa.JSON(), default=[]),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("uploaded_by", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_documents_partner_id", "partner_documents", ["partner_id"])
    op.create_index("ix_partner_documents_institution_id", "partner_documents", ["institution_id"])

    # ── partner_reminders ───────────────────────────────────────────────────────
    op.create_table(
        "partner_reminders",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=False),
        sa.Column("reminder_type", sa.String(50), default="follow_up"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("meeting_id", sa.String(), sa.ForeignKey("partner_meetings.id"), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("dismissed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_reminders_partner_id", "partner_reminders", ["partner_id"])
    op.create_index("ix_partner_reminders_user_id", "partner_reminders", ["user_id"])
    op.create_index("ix_partner_reminders_scheduled_for", "partner_reminders", ["scheduled_for"])


def downgrade() -> None:
    op.drop_table("partner_reminders")
    op.drop_table("partner_documents")
    op.drop_table("partner_meetings")

    for col in [
        "organization_id", "institution_id", "orcid", "google_scholar_id", "h_index",
        "expertise_embedding", "relationship_stage", "avatar_url", "department",
        "country", "city", "last_enriched_at", "enrichment_source", "enrichment_status",
    ]:
        op.drop_column("partners", col)

    op.drop_table("partner_organizations")
