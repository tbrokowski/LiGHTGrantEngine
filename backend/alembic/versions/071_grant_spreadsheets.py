"""Grant spreadsheets: Excel workbooks co-edited through OnlyOffice.

`grant_spreadsheets` holds the current file per workbook, with the OnlyOffice
session key; `grant_spreadsheet_versions` keeps every saved snapshot.
"""
from alembic import op
import sqlalchemy as sa

revision = "071_grant_spreadsheets"
down_revision = "070_messaging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grant_spreadsheets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=False),
        sa.Column("file_ext", sa.String(10), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), server_default="0"),
        sa.Column("version", sa.Integer(), server_default="1"),
        sa.Column("doc_key", sa.String(128), nullable=False),
        sa.Column("uploaded_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("last_edited_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_grant_spreadsheets_grant_id", "grant_spreadsheets", ["grant_id"])

    op.create_table(
        "grant_spreadsheet_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("spreadsheet_id", sa.String(), sa.ForeignKey("grant_spreadsheets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), server_default="0"),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_grant_spreadsheet_versions_spreadsheet_id", "grant_spreadsheet_versions", ["spreadsheet_id"])


def downgrade() -> None:
    op.drop_index("ix_grant_spreadsheet_versions_spreadsheet_id", table_name="grant_spreadsheet_versions")
    op.drop_table("grant_spreadsheet_versions")
    op.drop_index("ix_grant_spreadsheets_grant_id", table_name="grant_spreadsheets")
    op.drop_table("grant_spreadsheets")
