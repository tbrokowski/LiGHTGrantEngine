"""Add call_strategy, aligned_concept, overview_figure columns to active_grants.

Revision ID: 032
Revises: 031
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("call_strategy", sa.JSON(), nullable=True))
    op.add_column("active_grants", sa.Column("aligned_concept", sa.JSON(), nullable=True))
    op.add_column("active_grants", sa.Column("overview_figure_url", sa.Text(), nullable=True))
    op.add_column("active_grants", sa.Column("overview_figure_alt", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "overview_figure_alt")
    op.drop_column("active_grants", "overview_figure_url")
    op.drop_column("active_grants", "aligned_concept")
    op.drop_column("active_grants", "call_strategy")
