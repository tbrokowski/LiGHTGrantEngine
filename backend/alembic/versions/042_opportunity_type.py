"""Add opportunity_type column to opportunities table."""

import sqlalchemy as sa
from alembic import op

revision = "042_opportunity_type"
down_revision = "041_pause_award_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "opportunities",
        sa.Column("opportunity_type", sa.String(50), nullable=True),
    )
    op.create_index(
        "ix_opportunities_opportunity_type",
        "opportunities",
        ["opportunity_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_opportunities_opportunity_type", table_name="opportunities")
    op.drop_column("opportunities", "opportunity_type")
