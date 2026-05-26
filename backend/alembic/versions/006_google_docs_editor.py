"""Add unified editor_document and Google Docs sync fields to active_grants

Revision ID: 006
Revises: 005
Create Date: 2026-05-14

"""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("editor_document", sa.Text(), nullable=True))
    op.add_column("active_grants", sa.Column("google_doc_id", sa.String(100), nullable=True))
    op.add_column("active_grants", sa.Column("google_doc_url", sa.String(1000), nullable=True))
    op.add_column("active_grants", sa.Column("google_doc_last_synced", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "google_doc_last_synced")
    op.drop_column("active_grants", "google_doc_url")
    op.drop_column("active_grants", "google_doc_id")
    op.drop_column("active_grants", "editor_document")
