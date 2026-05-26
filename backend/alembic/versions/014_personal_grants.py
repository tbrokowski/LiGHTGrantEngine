"""Add is_personal flag to active_grants for personal/prototype grants.

Revision ID: 014
Revises: 013
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_grants",
        sa.Column(
            "is_personal",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.create_index("ix_active_grants_is_personal", "active_grants", ["is_personal"])


def downgrade() -> None:
    op.drop_index("ix_active_grants_is_personal", table_name="active_grants")
    op.drop_column("active_grants", "is_personal")
