"""Precomputed graph atlas snapshots.

The graph view now renders the whole corpus rather than a 1200-node subgraph.
Assembling that per request would mean touching every node and edge on every
page load, so the clustering task builds it once and stores the gzipped payload
here; the endpoint serves the stored bytes with an ETag, identical for all users.
"""
from alembic import op
import sqlalchemy as sa

revision = "060_graph_snapshots"
down_revision = "059_graph_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "graph_snapshots",
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.LargeBinary(), nullable=False),
        sa.Column("etag", sa.String(length=64), nullable=False),
        sa.Column("node_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("edge_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("format_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "computed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("kind"),
    )


def downgrade() -> None:
    op.drop_table("graph_snapshots")
