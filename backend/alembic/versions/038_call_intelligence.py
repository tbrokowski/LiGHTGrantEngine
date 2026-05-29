"""Add call_intelligence JSON field to active_grants for meta-synthesizer output.

Revision ID: 038
Revises: 037
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_grants",
        sa.Column("call_intelligence", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("active_grants", "call_intelligence")
