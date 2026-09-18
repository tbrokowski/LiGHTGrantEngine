"""Calibrated ranking artifacts on institution taste profiles.

Adds `prototypes` (packed multi-prototype taste vectors + labels) and
`ranking_meta` (funder affinity, median award, raw-score quantile breakpoints)
to institution_taste_profiles. Both feed services/grant_ranker.py, which
replaces the uncalibrated cosine blend that compressed every fit score into the
20s-50s.

Both columns are nullable with no backfill — `taste_profile_tasks` repopulates
them on its next scheduled run, and the ranker degrades to the declared-profile
embedding until then.
"""
from alembic import op
import sqlalchemy as sa

revision = "058_calibrated_ranking"
down_revision = "057_expert_reviewer"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "institution_taste_profiles",
        sa.Column("prototypes", sa.JSON(), nullable=True),
    )
    op.add_column(
        "institution_taste_profiles",
        sa.Column("ranking_meta", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("institution_taste_profiles", "ranking_meta")
    op.drop_column("institution_taste_profiles", "prototypes")
