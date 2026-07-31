"""Feedback — user-submitted comments/concerns/bugs/revisions log.

Every submission from the in-app feedback widget is stored here (the running
log) and also emailed to the feedback inbox.
"""
from alembic import op
import sqlalchemy as sa

revision = "054_feedback"
down_revision = "053_workspace_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("user_email", sa.String(length=300), nullable=True),
        sa.Column("user_name", sa.String(length=200), nullable=True),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="other"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("page_url", sa.String(length=1000), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="new"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feedback_user_id", "feedback", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_user_id", table_name="feedback")
    op.drop_table("feedback")
