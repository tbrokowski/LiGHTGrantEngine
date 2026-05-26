"""RAG style corpus — structure, style fingerprint, section ordering

Revision ID: 009
Revises: 008
Create Date: 2026-05-22

"""
from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grant_archives", sa.Column("document_structure", sa.JSON(), nullable=True))
    op.add_column("grant_archives", sa.Column("style_fingerprint", sa.JSON(), nullable=True))
    op.add_column("grant_archives", sa.Column("style_indexed_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("proposal_sections", sa.Column("section_order", sa.Integer(), nullable=True))
    op.add_column("proposal_sections", sa.Column("heading_level", sa.Integer(), nullable=True))

    op.add_column("reusable_language_blocks", sa.Column("archive_id", sa.String(), sa.ForeignKey("grant_archives.id"), nullable=True))
    op.add_column("reusable_language_blocks", sa.Column("source_section_id", sa.String(), sa.ForeignKey("proposal_sections.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("reusable_language_blocks", "source_section_id")
    op.drop_column("reusable_language_blocks", "archive_id")
    op.drop_column("proposal_sections", "heading_level")
    op.drop_column("proposal_sections", "section_order")
    op.drop_column("grant_archives", "style_indexed_at")
    op.drop_column("grant_archives", "style_fingerprint")
    op.drop_column("grant_archives", "document_structure")
