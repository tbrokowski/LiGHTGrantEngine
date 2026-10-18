"""Grant writing docs: extra documents in the grant editor beside the proposal."""
from alembic import op
import sqlalchemy as sa

revision = "072_grant_writing_docs"
down_revision = "071_grant_spreadsheets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grant_writing_docs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("content_html", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), server_default="0"),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_grant_writing_docs_grant_id", "grant_writing_docs", ["grant_id"])


def downgrade() -> None:
    op.drop_index("ix_grant_writing_docs_grant_id", table_name="grant_writing_docs")
    op.drop_table("grant_writing_docs")
