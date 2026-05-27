"""Add umap_x/umap_y to opportunities and create opportunity_edges table."""
from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # UMAP 2D layout coordinates for each opportunity
    op.add_column("opportunities", sa.Column("umap_x", sa.Float(), nullable=True))
    op.add_column("opportunities", sa.Column("umap_y", sa.Float(), nullable=True))

    # Weighted similarity edges between opportunities (kNN graph)
    op.create_table(
        "opportunity_edges",
        sa.Column("source_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_id", "target_id"),
    )
    op.create_index("ix_opportunity_edges_source_id", "opportunity_edges", ["source_id"])
    op.create_index("ix_opportunity_edges_target_id", "opportunity_edges", ["target_id"])


def downgrade() -> None:
    op.drop_index("ix_opportunity_edges_target_id", table_name="opportunity_edges")
    op.drop_index("ix_opportunity_edges_source_id", table_name="opportunity_edges")
    op.drop_table("opportunity_edges")
    op.drop_column("opportunities", "umap_y")
    op.drop_column("opportunities", "umap_x")
