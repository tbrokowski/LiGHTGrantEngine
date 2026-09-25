"""Partners: a researched bio and the sources it came from.

Web research (bulk add-from-emails and "Enrich now") writes a multi-sentence
bio. It previously landed in `notes`, overwriting whatever the team had
written there; it now has its own column, with the URLs it was built from
kept alongside so a reader can check where a claim came from.
"""
from alembic import op
import sqlalchemy as sa

revision = "062_partner_bio"
down_revision = "061_backfill_grant_archives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("partners", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("partners", sa.Column("enrichment_sources", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("partners", "enrichment_sources")
    op.drop_column("partners", "bio")
