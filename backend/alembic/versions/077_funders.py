"""Funders: a whale-tier on partners, and per-organization feature switches.

A funder is an ordinary partner with `funder_tier` set, so the Funders tab
shares the partner's interactions, tasks, meetings and follow-ups.
`institutions.features` holds switches such as {"funders": true}; the
Funders tab is switched on for the LiGHT organization.
"""
from alembic import op
import sqlalchemy as sa

revision = "077_funders"
down_revision = "076_archive_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("partners", sa.Column("funder_tier", sa.String(40), nullable=True))
    op.create_index("ix_partners_funder_tier", "partners", ["funder_tier"])

    op.add_column(
        "institutions",
        sa.Column("features", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    # The Funders tab is LiGHT's; other organizations can be switched on by a super-admin.
    op.execute(
        """
        UPDATE institutions SET features = '{"funders": true}'
        WHERE is_personal = false AND (name LIKE '%LiGHT%' OR lower(name) = 'light')
        """
    )


def downgrade() -> None:
    op.drop_column("institutions", "features")
    op.drop_index("ix_partners_funder_tier", table_name="partners")
    op.drop_column("partners", "funder_tier")
