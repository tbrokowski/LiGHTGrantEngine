"""User opportunity read state

Revision ID: 008
Revises: 007
Create Date: 2026-05-22

"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_opportunity_states",
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("opportunity_id", sa.String(), sa.ForeignKey("opportunities.id"), primary_key=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_user_opportunity_states_user_id",
        "user_opportunity_states",
        ["user_id"],
    )
    op.create_index(
        "ix_user_opportunity_states_opportunity_id",
        "user_opportunity_states",
        ["opportunity_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_opportunity_states_opportunity_id", table_name="user_opportunity_states")
    op.drop_index("ix_user_opportunity_states_user_id", table_name="user_opportunity_states")
    op.drop_table("user_opportunity_states")
