"""Add outcome tracking (awarded/declined/not_pursued) to institution_opportunities."""

import sqlalchemy as sa
from alembic import op

revision = "044_institution_opportunity_outcome"
down_revision = "043_add_nihr_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "institution_opportunities",
        sa.Column("outcome", sa.String(50), nullable=True),
    )
    op.add_column(
        "institution_opportunities",
        sa.Column("outcome_recorded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_institution_opportunities_outcome",
        "institution_opportunities",
        ["outcome"],
    )


def downgrade() -> None:
    op.drop_index("ix_institution_opportunities_outcome", table_name="institution_opportunities")
    op.drop_column("institution_opportunities", "outcome_recorded_at")
    op.drop_column("institution_opportunities", "outcome")
