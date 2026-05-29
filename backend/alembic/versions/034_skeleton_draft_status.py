"""Add skeleton_status/steps/error and draft_status/steps/error to active_grants.

Revision ID: 034
Revises: 033
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("skeleton_status", sa.String(20), nullable=False, server_default="idle"))
    op.add_column("active_grants", sa.Column("skeleton_steps",  sa.JSON(),      nullable=True))
    op.add_column("active_grants", sa.Column("skeleton_error",  sa.Text(),      nullable=True))
    op.add_column("active_grants", sa.Column("draft_status",    sa.String(20), nullable=False, server_default="idle"))
    op.add_column("active_grants", sa.Column("draft_steps",     sa.JSON(),      nullable=True))
    op.add_column("active_grants", sa.Column("draft_error",     sa.Text(),      nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "draft_error")
    op.drop_column("active_grants", "draft_steps")
    op.drop_column("active_grants", "draft_status")
    op.drop_column("active_grants", "skeleton_error")
    op.drop_column("active_grants", "skeleton_steps")
    op.drop_column("active_grants", "skeleton_status")
