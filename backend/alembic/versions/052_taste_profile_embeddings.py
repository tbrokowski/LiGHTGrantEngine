"""Profile embeddings for ranking — org profile_embedding + per-user taste.

Adds `profile_embedding` to institution_taste_profiles (semantic anchor for org
fit) and a `user_taste_profiles` table (behavioral + explicit per-user signal),
both feeding the blended, personalized opportunities ranking.
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "052_taste_profile_embeddings"
down_revision = "051_opportunity_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "institution_taste_profiles",
        sa.Column("profile_embedding", Vector(1536), nullable=True),
    )
    op.create_table(
        "user_taste_profiles",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("positive_embedding", Vector(1536), nullable=True),
        sa.Column("profile_embedding", Vector(1536), nullable=True),
        sa.Column("positive_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_taste_profiles")
    op.drop_column("institution_taste_profiles", "profile_embedding")
