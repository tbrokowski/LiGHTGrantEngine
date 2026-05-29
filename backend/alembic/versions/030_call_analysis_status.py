"""Add call_analysis_status and call_analysis_error to active_grants for async analysis jobs.

Revision ID: 030
Revises: 029
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_grants",
        sa.Column("call_analysis_status", sa.String(20), nullable=False, server_default="idle"),
    )
    op.add_column(
        "active_grants",
        sa.Column("call_analysis_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("active_grants", "call_analysis_error")
    op.drop_column("active_grants", "call_analysis_status")
