"""Grant members table + task assignee_ids

Revision ID: 011
Revises: 010
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grant_members",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("email", sa.String(300), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="editor"),
        sa.Column("status", sa.String(50), nullable=False, server_default="accepted"),
        sa.Column("invited_by_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_grant_members_grant_id", "grant_members", ["grant_id"])
    op.create_index("ix_grant_members_user_id", "grant_members", ["user_id"])
    op.create_index("ix_grant_members_email", "grant_members", ["email"])

    op.add_column("tasks", sa.Column("assignee_ids", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("tasks", "assignee_ids")
    op.drop_index("ix_grant_members_email", "grant_members")
    op.drop_index("ix_grant_members_user_id", "grant_members")
    op.drop_index("ix_grant_members_grant_id", "grant_members")
    op.drop_table("grant_members")
