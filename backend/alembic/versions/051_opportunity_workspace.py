"""Opportunity card workspace — scoped tasks, notes, and links.

Lightweight per-(scope, owner) workspace attached to an opportunity so teams can
plan a pursuit before converting it to a grant. scope='org' is shared across the
institution; scope='user' is private to the user. See app/models/opportunity_task.py.
"""
from alembic import op
import sqlalchemy as sa

revision = "051_opportunity_workspace"
down_revision = "050_section_chunks"
branch_labels = None
depends_on = None


def _scoped_cols() -> list:
    return [
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("opportunity_id", sa.String(), nullable=False),
        sa.Column("scope", sa.String(10), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("created_by_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "opportunity_tasks",
        *_scoped_cols(),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("assignee_ids", sa.JSON(), nullable=True),
        sa.Column("remind_days_before", sa.JSON(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["opportunity_id"], ["opportunities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_opportunity_tasks_opportunity_id", "opportunity_tasks", ["opportunity_id"])
    op.create_index("ix_opportunity_tasks_owner_id", "opportunity_tasks", ["owner_id"])
    op.create_index("ix_opportunity_tasks_due_date", "opportunity_tasks", ["due_date"])

    op.create_table(
        "opportunity_notes",
        *_scoped_cols(),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["opportunity_id"], ["opportunities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_opportunity_notes_opportunity_id", "opportunity_notes", ["opportunity_id"])
    op.create_index("ix_opportunity_notes_owner_id", "opportunity_notes", ["owner_id"])

    op.create_table(
        "opportunity_links",
        *_scoped_cols(),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("url", sa.String(2000), nullable=False),
        sa.ForeignKeyConstraint(["opportunity_id"], ["opportunities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_opportunity_links_opportunity_id", "opportunity_links", ["opportunity_id"])
    op.create_index("ix_opportunity_links_owner_id", "opportunity_links", ["owner_id"])


def downgrade() -> None:
    for tbl in ("opportunity_links", "opportunity_notes", "opportunity_tasks"):
        op.drop_table(tbl)
