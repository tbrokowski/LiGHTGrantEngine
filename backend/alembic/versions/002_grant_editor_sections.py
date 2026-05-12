"""Add editor_sections and call_requirements to active_grants

Revision ID: 002
Revises: 001
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("editor_sections", sa.JSON(), nullable=True, server_default="{}"))
    op.add_column("active_grants", sa.Column("call_requirements", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "editor_sections")
    op.drop_column("active_grants", "call_requirements")
