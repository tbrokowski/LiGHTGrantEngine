"""Add grant_id FK to proposal_sections for per-grant workspace RAG.

Workspace-uploaded reference documents (past proposals, project reports) are
chunked into ProposalSection rows linked via grant_id instead of archive_id.
This lets the skeleton generator retrieve content from uploaded reference docs
alongside archived past grants.

Revision ID: 029
Revises: 028
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "proposal_sections",
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_proposal_sections_grant_id", "proposal_sections", ["grant_id"])


def downgrade() -> None:
    op.drop_index("ix_proposal_sections_grant_id", table_name="proposal_sections")
    op.drop_column("proposal_sections", "grant_id")
