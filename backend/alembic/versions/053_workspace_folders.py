"""Workspace folders — one level of grouping for a grant's saved files.

Adds a `workspace_folders` table and a nullable `folder_id` on `workspace_files`
so the files panel can group files into folders (files with folder_id NULL are
"loose" and show at the front). Deleting a folder sets its files back to loose
(ON DELETE SET NULL), never deletes the files.
"""
from alembic import op
import sqlalchemy as sa

revision = "053_workspace_folders"
down_revision = "052_taste_profile_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_folders",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("grant_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["grant_id"], ["active_grants.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workspace_folders_grant_id", "workspace_folders", ["grant_id"])

    op.add_column(
        "workspace_files",
        sa.Column("folder_id", sa.String(), nullable=True),
    )
    op.create_index("ix_workspace_files_folder_id", "workspace_files", ["folder_id"])
    op.create_foreign_key(
        "fk_workspace_files_folder_id",
        "workspace_files",
        "workspace_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_workspace_files_folder_id", "workspace_files", type_="foreignkey")
    op.drop_index("ix_workspace_files_folder_id", table_name="workspace_files")
    op.drop_column("workspace_files", "folder_id")
    op.drop_index("ix_workspace_folders_grant_id", table_name="workspace_folders")
    op.drop_table("workspace_folders")
