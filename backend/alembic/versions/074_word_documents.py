"""Word documents: edit .docx files in OnlyOffice, with versions and a Google Docs copy."""
from alembic import op
import sqlalchemy as sa

revision = "074_word_documents"
down_revision = "073_spreadsheet_folder"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("edit_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("documents", sa.Column("oo_doc_key", sa.String(128), nullable=True))
    op.add_column("documents", sa.Column("oo_session_users", sa.JSON(), nullable=True))
    op.add_column("documents", sa.Column(
        "last_edited_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    ))
    op.add_column("documents", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("google_file_id", sa.String(200), nullable=True))
    op.add_column("documents", sa.Column("google_file_url", sa.String(1000), nullable=True))
    op.add_column("documents", sa.Column(
        "google_owner_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    ))
    op.add_column("documents", sa.Column("google_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("google_synced_version", sa.Integer(), nullable=True))

    op.create_table(
        "document_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("document_id", sa.String(), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("size_bytes", sa.Integer(), server_default="0"),
        sa.Column("source", sa.String(20), server_default="editor"),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])

    op.add_column("grant_writing_docs", sa.Column(
        "document_id", sa.String(), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=True,
    ))
    op.create_index("ix_grant_writing_docs_document_id", "grant_writing_docs", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_grant_writing_docs_document_id", table_name="grant_writing_docs")
    op.drop_column("grant_writing_docs", "document_id")
    op.drop_index("ix_document_versions_document_id", table_name="document_versions")
    op.drop_table("document_versions")
    for col in (
        "google_synced_version", "google_synced_at", "google_owner_id", "google_file_url", "google_file_id",
        "edited_at", "last_edited_by_id", "oo_session_users", "oo_doc_key", "edit_version",
    ):
        op.drop_column("documents", col)
