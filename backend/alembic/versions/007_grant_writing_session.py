"""Grant writing session fields and related tables

Revision ID: 007
Revises: 006
Create Date: 2026-05-22

"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("grant_idea", sa.Text(), nullable=True))
    op.add_column("active_grants", sa.Column("call_analysis", sa.JSON(), nullable=True))
    op.add_column("active_grants", sa.Column("proposal_skeleton", sa.JSON(), nullable=True))
    op.add_column("active_grants", sa.Column("style_profile", sa.JSON(), nullable=True))
    op.add_column("active_grants", sa.Column("writing_phase", sa.String(30), server_default="idea", nullable=False))
    op.add_column("active_grants", sa.Column("last_review", sa.JSON(), nullable=True))

    op.create_table(
        "grant_writing_conversations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False, index=True),
        sa.Column("messages", sa.JSON(), server_default="[]"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "grant_citations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False, index=True),
        sa.Column("section_title", sa.String(500), nullable=True),
        sa.Column("claim_text", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(50), nullable=True),
        sa.Column("external_id", sa.String(200), nullable=True),
        sa.Column("formatted_citation", sa.Text(), nullable=True),
        sa.Column("url", sa.String(1000), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("grant_citations")
    op.drop_table("grant_writing_conversations")
    op.drop_column("active_grants", "last_review")
    op.drop_column("active_grants", "writing_phase")
    op.drop_column("active_grants", "style_profile")
    op.drop_column("active_grants", "proposal_skeleton")
    op.drop_column("active_grants", "call_analysis")
    op.drop_column("active_grants", "grant_idea")
