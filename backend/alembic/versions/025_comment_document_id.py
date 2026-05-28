"""Add document_id to comments for per-document scoping.

Revision ID: 025
Revises: 024
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "comments",
        sa.Column(
            "document_id",
            sa.String(255),
            nullable=False,
            server_default="draft",
        ),
    )
    op.create_index("ix_comments_document_id", "comments", ["document_id"])


def downgrade():
    op.drop_index("ix_comments_document_id", table_name="comments")
    op.drop_column("comments", "document_id")
