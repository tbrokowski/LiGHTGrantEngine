"""Add shortlist_categories (Kanban lanes) + per-card category FKs.

Both shortlist tabs become drag-and-drop category boards. Categories are
per-user (scope='user') or per-institution (scope='org'); each shortlisted
opportunity references its lane via a nullable FK on the relevant join row.
"""
from alembic import op
import sqlalchemy as sa

revision = "048_shortlist_categories"
down_revision = "047_sync_grant_stage_from_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shortlist_categories",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("scope", sa.String(10), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shortlist_categories_owner_id", "shortlist_categories", ["owner_id"])

    op.add_column(
        "user_opportunity_states",
        sa.Column("shortlist_category_id", sa.String(),
                  sa.ForeignKey("shortlist_categories.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "institution_opportunities",
        sa.Column("shortlist_category_id", sa.String(),
                  sa.ForeignKey("shortlist_categories.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("institution_opportunities", "shortlist_category_id")
    op.drop_column("user_opportunity_states", "shortlist_category_id")
    op.drop_index("ix_shortlist_categories_owner_id", table_name="shortlist_categories")
    op.drop_table("shortlist_categories")
