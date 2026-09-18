"""Indexes for the full-corpus similarity graph.

The graph view expands a seed set along `opportunity_edges` in both directions.
The table's primary key is (source_id, target_id), which indexes source_id
lookups but leaves target_id unindexed — so the reverse half of every expansion
was a sequential scan.

Also upgrades the opportunity embedding index to HNSW where the installed
pgvector supports it. The clustering pipeline now issues one indexed kNN probe
per node (a LATERAL join) instead of an in-memory all-pairs scan, so recall and
latency of that index directly determine graph quality. HNSW gives markedly
better recall-per-probe than IVFFlat; the IVFFlat index is left in place as a
fallback when HNSW is unavailable (pgvector < 0.5.0).
"""
from alembic import op
import sqlalchemy as sa

revision = "059_graph_indexes"
down_revision = "058_calibrated_ranking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # CONCURRENTLY cannot run inside Alembic's transaction block.
    with op.get_context().autocommit_block():
        conn.execute(sa.text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_opportunity_edges_target "
            "ON opportunity_edges (target_id)"
        ))
        # Supports the weight-ordered scan that builds the expansion adjacency.
        conn.execute(sa.text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_opportunity_edges_weight "
            "ON opportunity_edges (weight DESC)"
        ))

        # HNSW needs pgvector >= 0.5.0 and at least one embedded row to be useful.
        has_rows = conn.execute(sa.text(
            "SELECT 1 FROM opportunities WHERE embedding IS NOT NULL LIMIT 1"
        )).first()
        if has_rows:
            try:
                conn.execute(sa.text(
                    "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
                    "ix_opportunities_embedding_hnsw "
                    "ON opportunities USING hnsw (embedding vector_cosine_ops) "
                    "WITH (m = 16, ef_construction = 64)"
                ))
                print("Created HNSW index on opportunities.embedding")
            except Exception as exc:
                print(
                    f"Skipped HNSW index ({exc}). The existing IVFFlat index still "
                    "serves the kNN scan; upgrade pgvector to 0.5.0+ to enable HNSW."
                )
        else:
            print(
                "Skipped HNSW index — no embeddings exist yet. Re-run after the "
                "tagger backfill has populated embeddings."
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        conn = op.get_bind()
        conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_opportunities_embedding_hnsw"))
        conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_opportunity_edges_weight"))
        conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_opportunity_edges_target"))
