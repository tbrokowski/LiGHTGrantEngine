"""Add CRM partner tables

Revision ID: 002
Revises: 001
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── partners ──────────────────────────────────────────
    op.create_table(
        "partners",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("email", sa.String(300)),
        sa.Column("phone", sa.String(100)),
        sa.Column("organization", sa.String(300)),
        sa.Column("title", sa.String(200)),
        sa.Column("linkedin_url", sa.String(1000)),
        sa.Column("website", sa.String(1000)),
        sa.Column("tags", sa.JSON(), default=[]),
        sa.Column("project_types", sa.JSON(), default=[]),
        sa.Column("status", sa.String(50), default="active"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partners_email", "partners", ["email"])
    op.create_index("ix_partners_organization", "partners", ["organization"])
    op.create_index("ix_partners_status", "partners", ["status"])
    op.create_index("ix_partners_name", "partners", ["name"])

    # ── partner_updates ───────────────────────────────────
    op.create_table(
        "partner_updates",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("update_type", sa.String(50), default="note"),
        sa.Column("contact_date", sa.DateTime(timezone=True)),
        sa.Column("next_contact_date", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_updates_partner_id", "partner_updates", ["partner_id"])
    op.create_index("ix_partner_updates_next_contact_date", "partner_updates", ["next_contact_date"])
    op.create_index("ix_partner_updates_user_id", "partner_updates", ["user_id"])

    # ── partner_grant_links ───────────────────────────────
    op.create_table(
        "partner_grant_links",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id"), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("relationship", sa.String(100), default="collaborator"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_grant_links_partner_id", "partner_grant_links", ["partner_id"])
    op.create_index("ix_partner_grant_links_entity_id", "partner_grant_links", ["entity_id"])
    op.create_index("ix_partner_grant_links_entity_type", "partner_grant_links", ["entity_type"])


def downgrade() -> None:
    op.drop_table("partner_grant_links")
    op.drop_table("partner_updates")
    op.drop_table("partners")
