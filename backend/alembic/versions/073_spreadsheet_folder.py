"""Budget workbooks can sit in a grant's workspace folders, like saved files."""
from alembic import op
import sqlalchemy as sa

revision = "073_spreadsheet_folder"
down_revision = "072_grant_writing_docs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "grant_spreadsheets",
        sa.Column("folder_id", sa.String(), sa.ForeignKey("workspace_folders.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_grant_spreadsheets_folder_id", "grant_spreadsheets", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_grant_spreadsheets_folder_id", table_name="grant_spreadsheets")
    op.drop_column("grant_spreadsheets", "folder_id")
