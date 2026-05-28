"""Grant editor comment extensions

Revision ID: 024
Revises: 023
Create Date: 2026-05-28

"""
from alembic import op
import sqlalchemy as sa

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add grant-editor comment fields to the existing comments table
    op.add_column("comments", sa.Column("parent_id", sa.String(), sa.ForeignKey("comments.id"), nullable=True))
    op.add_column("comments", sa.Column("anchor_text", sa.Text(), nullable=True))
    op.add_column("comments", sa.Column("resolved", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("comments", sa.Column("google_doc_comment_id", sa.String(), nullable=True))
    op.create_index("ix_comments_google_doc_comment_id", "comments", ["google_doc_comment_id"])


def downgrade() -> None:
    op.drop_index("ix_comments_google_doc_comment_id", table_name="comments")
    op.drop_column("comments", "google_doc_comment_id")
    op.drop_column("comments", "resolved")
    op.drop_column("comments", "anchor_text")
    op.drop_column("comments", "parent_id")
