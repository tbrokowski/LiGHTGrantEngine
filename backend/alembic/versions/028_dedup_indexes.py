"""Add dedup indexes: upper(opportunity_number), lower(title).

These indexes speed up the multi-signal composite dedup queries introduced
in opportunity_dedup.py — specifically the external-ID lookup (pass 1) and
the title+funder-prefix fallback (passes 3/4).

Revision ID: 028
Revises: 027
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Functional index on upper(opportunity_number) for external-ID dedup.
    # Partial so it only covers rows where the column is set.
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_opp_opportunity_number_upper
          ON opportunities (upper(opportunity_number))
          WHERE opportunity_number IS NOT NULL
    """))

    # Functional index on lower(title) for title-based dedup queries.
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_opp_title_lower
          ON opportunities (lower(title))
    """))

    # Functional index on lower(opportunity_url) for normalised URL lookups.
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_opp_url_lower
          ON opportunities (lower(opportunity_url))
          WHERE opportunity_url IS NOT NULL
    """))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_opp_opportunity_number_upper"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_opp_title_lower"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_opp_url_lower"))
