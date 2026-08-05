"""Per-user negative taste centroid.

Adds `negative_embedding` + `negative_count` to user_taste_profiles so the
personalized feed can push down opportunities similar to ones the user has
dismissed ("Not interested"), mirroring the institution taste profile which
already carries a negative centroid. Additive/non-destructive.
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "056_user_taste_negative"
down_revision = "055_llm_keys_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_taste_profiles",
        sa.Column("negative_embedding", Vector(1536), nullable=True),
    )
    op.add_column(
        "user_taste_profiles",
        sa.Column("negative_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("user_taste_profiles", "negative_count")
    op.drop_column("user_taste_profiles", "negative_embedding")
