"""Add institution_id and created_by_id to active_grants

Revision ID: 012
Revises: 011
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_grants",
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=True),
    )
    op.add_column(
        "active_grants",
        sa.Column("created_by_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_active_grants_institution_id", "active_grants", ["institution_id"])
    op.create_index("ix_active_grants_created_by_id", "active_grants", ["created_by_id"])

    # Backfill created_by_id from internal_lead_id where present
    op.execute(
        """
        UPDATE active_grants
        SET created_by_id = internal_lead_id
        WHERE created_by_id IS NULL AND internal_lead_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_active_grants_created_by_id", "active_grants")
    op.drop_index("ix_active_grants_institution_id", "active_grants")
    op.drop_column("active_grants", "created_by_id")
    op.drop_column("active_grants", "institution_id")
