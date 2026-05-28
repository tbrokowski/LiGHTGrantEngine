"""Per-user personal shortlist

Revision ID: 023
Revises: 022
Create Date: 2026-05-28

"""
from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_shortlists",
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column(
            "opportunity_id",
            sa.String(),
            sa.ForeignKey("opportunities.id"),
            primary_key=True,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_user_shortlists_user_id",
        "user_shortlists",
        ["user_id"],
    )
    op.create_index(
        "ix_user_shortlists_opportunity_id",
        "user_shortlists",
        ["opportunity_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_shortlists_opportunity_id", table_name="user_shortlists")
    op.drop_index("ix_user_shortlists_user_id", table_name="user_shortlists")
    op.drop_table("user_shortlists")
