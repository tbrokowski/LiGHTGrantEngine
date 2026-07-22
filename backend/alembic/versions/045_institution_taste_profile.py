"""Add institution_taste_profiles table for behavior-based auto-ranking.

Stores per-institution positive/negative centroid embeddings computed from
InstitutionOpportunity outcome/status history, used to nudge fit scores toward
what the org has actually pursued/won and away from what it passed on.
"""
from alembic import op
import sqlalchemy as sa

revision = "045_institution_taste_profile"
down_revision = "044_institution_opp_outcome"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "institution_taste_profiles",
        sa.Column("institution_id", sa.String(), nullable=False),
        sa.Column("positive_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("negative_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"]),
        sa.PrimaryKeyConstraint("institution_id"),
    )
    op.execute("ALTER TABLE institution_taste_profiles ADD COLUMN positive_embedding vector(1536)")
    op.execute("ALTER TABLE institution_taste_profiles ADD COLUMN negative_embedding vector(1536)")


def downgrade() -> None:
    op.drop_table("institution_taste_profiles")
