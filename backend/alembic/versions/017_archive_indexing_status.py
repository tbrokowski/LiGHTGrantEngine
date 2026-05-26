"""Add archive indexing status columns."""
from alembic import op
import sqlalchemy as sa

revision = "017_archive_indexing_status"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "grant_archives",
        sa.Column("indexing_status", sa.String(50), nullable=False, server_default="complete"),
    )
    op.add_column("grant_archives", sa.Column("indexing_error", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("grant_archives", "indexing_error")
    op.drop_column("grant_archives", "indexing_status")
