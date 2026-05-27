"""Add archive graph clustering tables and columns.

Adds:
  - archive_clusters table (Leiden communities for grant archives)
  - archive_edges table (kNN cosine-similarity edges between archives)
  - grant_archives.embedding Vector(1536) — weighted centroid of section embeddings
  - grant_archives.cluster_id FK → archive_clusters.id
  - grant_archives.umap_x / umap_y — UMAP 2D layout coordinates
"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Archive Leiden community clusters
    op.create_table(
        "archive_clusters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Weighted kNN similarity edges between archive entries
    op.create_table(
        "archive_edges",
        sa.Column(
            "source_id",
            sa.String(36),
            sa.ForeignKey("grant_archives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_id",
            sa.String(36),
            sa.ForeignKey("grant_archives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("source_id", "target_id"),
    )
    op.create_index("ix_archive_edges_source_id", "archive_edges", ["source_id"])
    op.create_index("ix_archive_edges_target_id", "archive_edges", ["target_id"])

    # Archive-level centroid embedding (weighted mean of section embeddings)
    op.execute("ALTER TABLE grant_archives ADD COLUMN embedding vector(1536)")

    # Cluster membership
    op.add_column(
        "grant_archives",
        sa.Column(
            "cluster_id",
            sa.Integer(),
            sa.ForeignKey("archive_clusters.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_grant_archives_cluster_id", "grant_archives", ["cluster_id"])

    # UMAP 2D layout coordinates
    op.add_column("grant_archives", sa.Column("umap_x", sa.Float(), nullable=True))
    op.add_column("grant_archives", sa.Column("umap_y", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("grant_archives", "umap_y")
    op.drop_column("grant_archives", "umap_x")
    op.drop_index("ix_grant_archives_cluster_id", table_name="grant_archives")
    op.drop_column("grant_archives", "cluster_id")
    op.execute("ALTER TABLE grant_archives DROP COLUMN embedding")
    op.drop_index("ix_archive_edges_target_id", table_name="archive_edges")
    op.drop_index("ix_archive_edges_source_id", table_name="archive_edges")
    op.drop_table("archive_edges")
    op.drop_table("archive_clusters")
