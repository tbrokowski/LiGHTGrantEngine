"""Add call_analysis_steps JSON column for step-level progress tracking.

Revision ID: 031
Revises: 030
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_grants",
        sa.Column("call_analysis_steps", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("active_grants", "call_analysis_steps")
