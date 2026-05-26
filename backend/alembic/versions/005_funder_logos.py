"""Add funder_logo_url to opportunities and logo_url to sources

Revision ID: 005
Revises: 004
Create Date: 2026-05-14

"""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("opportunities", sa.Column("funder_logo_url", sa.String(500), nullable=True))
    op.add_column("sources", sa.Column("logo_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("opportunities", "funder_logo_url")
    op.drop_column("sources", "logo_url")
