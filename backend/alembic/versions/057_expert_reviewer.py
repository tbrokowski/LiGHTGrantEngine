"""Expert reviewer: AI comment source/severity + grant review job state.

Adds `source`/`severity` to comments so the expert-reviewer agent's comments can
be badged and bulk-cleared distinctly from human comments, and adds
`ai_review_status`/`ai_review_error`/`ai_review_summary` to active_grants for the
async review job + its macro verdict. Additive/non-destructive.
"""
from alembic import op
import sqlalchemy as sa

revision = "057_expert_reviewer"
down_revision = "056_user_taste_negative"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("comments", sa.Column("source", sa.String(length=30), nullable=True))
    op.add_column("comments", sa.Column("severity", sa.String(length=20), nullable=True))
    op.create_index("ix_comments_source", "comments", ["source"])

    op.add_column(
        "active_grants",
        sa.Column("ai_review_status", sa.String(length=20), nullable=False, server_default="idle"),
    )
    op.add_column("active_grants", sa.Column("ai_review_error", sa.Text(), nullable=True))
    op.add_column("active_grants", sa.Column("ai_review_summary", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "ai_review_summary")
    op.drop_column("active_grants", "ai_review_error")
    op.drop_column("active_grants", "ai_review_status")
    op.drop_index("ix_comments_source", table_name="comments")
    op.drop_column("comments", "severity")
    op.drop_column("comments", "source")
