"""Add is_personal flag to institutions for solo workspaces.

Revision ID: 015
Revises: 014
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "institutions",
        sa.Column(
            "is_personal",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.create_index("ix_institutions_is_personal", "institutions", ["is_personal"])


def downgrade() -> None:
    op.drop_index("ix_institutions_is_personal", table_name="institutions")
    op.drop_column("institutions", "is_personal")
