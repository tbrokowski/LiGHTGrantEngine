"""Add color column to active_grants.

Revision ID: 021
Revises: 020
"""
from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("color", sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "color")
