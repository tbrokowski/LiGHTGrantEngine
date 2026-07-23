"""Contextual-retrieval chunks for proposal sections.

Sub-chunks of ProposalSection, each embedded over a context-prefixed window
(Anthropic Contextual Retrieval). Retrieval matches chunks, then maps back to
the parent section — see app/ai/rag/contextual_chunker.py and retriever.py.
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "050_section_chunks"
down_revision = "049_verbatim_reuse_default"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "section_chunks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("section_id", sa.String(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("context", sa.Text(), nullable=True),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["proposal_sections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_section_chunks_section_id", "section_chunks", ["section_id"])


def downgrade() -> None:
    op.drop_index("ix_section_chunks_section_id", table_name="section_chunks")
    op.drop_table("section_chunks")
