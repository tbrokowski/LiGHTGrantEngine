"""Writing docs: one can be the grant's main document (an uploaded proposal)."""
from alembic import op
import sqlalchemy as sa

revision = "075_writing_doc_main"
down_revision = "074_word_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grant_writing_docs", sa.Column("is_main", sa.Boolean(), nullable=False, server_default=sa.false()))
    # At most one main document per grant.
    op.create_index(
        "uq_grant_writing_docs_main", "grant_writing_docs", ["grant_id"],
        unique=True, postgresql_where=sa.text("is_main"),
    )


def downgrade() -> None:
    op.drop_index("uq_grant_writing_docs_main", table_name="grant_writing_docs")
    op.drop_column("grant_writing_docs", "is_main")
