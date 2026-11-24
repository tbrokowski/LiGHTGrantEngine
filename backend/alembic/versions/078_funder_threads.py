"""Funders: open threads, with funders assigned to them.

A thread is a team conversation on the Funders tab; funders (partners) are
assigned to it, and posts are the conversation itself.
"""
from alembic import op
import sqlalchemy as sa

revision = "078_funder_threads"
down_revision = "077_funders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "funder_threads",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_funder_threads_institution_id", "funder_threads", ["institution_id"])
    op.create_index("ix_funder_threads_status", "funder_threads", ["status"])
    op.create_index("ix_funder_threads_last_activity_at", "funder_threads", ["last_activity_at"])

    op.create_table(
        "funder_thread_partners",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("thread_id", sa.String(), sa.ForeignKey("funder_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("thread_id", "partner_id", name="uq_funder_thread_partner"),
    )
    op.create_index("ix_funder_thread_partners_thread_id", "funder_thread_partners", ["thread_id"])
    op.create_index("ix_funder_thread_partners_partner_id", "funder_thread_partners", ["partner_id"])

    op.create_table(
        "funder_thread_posts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("thread_id", sa.String(), sa.ForeignKey("funder_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_funder_thread_posts_thread_id", "funder_thread_posts", ["thread_id"])
    op.create_index("ix_funder_thread_posts_created_at", "funder_thread_posts", ["created_at"])


def downgrade() -> None:
    op.drop_table("funder_thread_posts")
    op.drop_table("funder_thread_partners")
    op.drop_table("funder_threads")
