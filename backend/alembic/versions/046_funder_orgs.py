"""Add funder_orgs table and Opportunity.funder_org_id.

Funder Org is the actual funding body (e.g. Fulbright), distinct from Source
(a scrapeable portal like UKRI's opportunity listing). Manually curated for
funders that are hard to scrape, with a name/url/notes/deadline_info an admin
maintains by hand.
"""
from alembic import op
import sqlalchemy as sa

revision = "046_funder_orgs"
down_revision = "045_institution_taste_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "funder_orgs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("url", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("deadline_info", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funder_orgs_name", "funder_orgs", ["name"])

    op.add_column(
        "opportunities",
        sa.Column("funder_org_id", sa.String(), sa.ForeignKey("funder_orgs.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_opportunities_funder_org_id", "opportunities", ["funder_org_id"])


def downgrade() -> None:
    op.drop_index("ix_opportunities_funder_org_id", table_name="opportunities")
    op.drop_column("opportunities", "funder_org_id")
    op.drop_index("ix_funder_orgs_name", table_name="funder_orgs")
    op.drop_table("funder_orgs")
