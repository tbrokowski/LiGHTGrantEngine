"""Add grant surfacing tables and profile columns.

Revision ID: 016
Revises: 015
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("institutions", sa.Column("grant_profile", sa.JSON(), nullable=True))
    op.add_column("users", sa.Column("grant_preferences", sa.JSON(), nullable=True))
    op.execute("UPDATE institutions SET grant_profile = '{}' WHERE grant_profile IS NULL")
    op.execute("UPDATE users SET grant_preferences = '{}' WHERE grant_preferences IS NULL")

    op.create_table(
        "institution_opportunities",
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), primary_key=True),
        sa.Column("opportunity_id", sa.String(), sa.ForeignKey("opportunities.id"), primary_key=True),
        sa.Column("fit_score", sa.Float(), nullable=True),
        sa.Column("priority", sa.String(50), nullable=True),
        sa.Column("fit_rationale", sa.Text(), nullable=True),
        sa.Column("matched_themes", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("status", sa.String(50), server_default="needs_review", nullable=False),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("surfaced_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_institution_opportunities_status", "institution_opportunities", ["status"])
    op.create_index("ix_institution_opportunities_fit_score", "institution_opportunities", ["fit_score"])

    op.create_table(
        "institution_sources",
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), primary_key=True),
        sa.Column("source_id", sa.String(), sa.ForeignKey("sources.id"), primary_key=True),
        sa.Column("is_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "preseed_runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(50), server_default="running", nullable=False),
        sa.Column("opportunities_total", sa.Integer(), server_default="0", nullable=False),
        sa.Column("opportunities_scored", sa.Integer(), server_default="0", nullable=False),
        sa.Column("errors", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("log_summary", sa.Text(), nullable=True),
    )
    op.create_index("ix_preseed_runs_institution_id", "preseed_runs", ["institution_id"])


def downgrade() -> None:
    op.drop_index("ix_preseed_runs_institution_id", table_name="preseed_runs")
    op.drop_table("preseed_runs")
    op.drop_table("institution_sources")
    op.drop_index("ix_institution_opportunities_fit_score", table_name="institution_opportunities")
    op.drop_index("ix_institution_opportunities_status", table_name="institution_opportunities")
    op.drop_table("institution_opportunities")
    op.drop_column("users", "grant_preferences")
    op.drop_column("institutions", "grant_profile")
