"""Add GIN indexes on thematic_areas/keywords and IVFFlat index on embedding.

Supports fast JSON-containment tag filtering and pgvector cosine-similarity
semantic search introduced by the universal grant tagger pipeline.

Revision ID: 037
Revises: 036
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # IVFFlat index for approximate cosine-similarity search.
    # We only create it when at least one row already has an embedding, because
    # IVFFlat needs data to build its inverted-file lists (lists=100 is fine
    # for up to ~1M rows; increase to sqrt(n) for larger corpora).
    row = conn.execute(sa.text(
        "SELECT 1 FROM opportunities WHERE embedding IS NOT NULL LIMIT 1"
    )).fetchone()

    # CONCURRENTLY cannot run inside Alembic's default transaction block.
    with op.get_context().autocommit_block():
        # GIN indexes speed up JSON containment queries like:
        #   WHERE thematic_areas @> '["healthcare"]'
        # and the ILIKE cast-to-text search added to the search endpoint.
        # Columns are JSON (not JSONB); cast for jsonb_path_ops GIN indexes.
        conn.execute(sa.text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_opportunities_thematic_areas_gin "
            "ON opportunities USING gin ((thematic_areas::jsonb) jsonb_path_ops)"
        ))
        conn.execute(sa.text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_opportunities_keywords_gin "
            "ON opportunities USING gin ((keywords::jsonb) jsonb_path_ops)"
        ))

        if row:
            conn.execute(sa.text(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
                "ix_opportunities_embedding_ivfflat "
                "ON opportunities USING ivfflat (embedding vector_cosine_ops) "
                "WITH (lists = 100)"
            ))
            print("Created IVFFlat index on opportunities.embedding")
        else:
            print(
                "Skipped IVFFlat index — no embeddings exist yet. "
                "Re-run this migration (or manually execute the CREATE INDEX statement) "
                "after the tagger backfill has populated at least some embeddings."
            )


def downgrade() -> None:
    conn = op.get_bind()
    with op.get_context().autocommit_block():
        conn.execute(sa.text(
            "DROP INDEX CONCURRENTLY IF EXISTS ix_opportunities_embedding_ivfflat"
        ))
        conn.execute(sa.text(
            "DROP INDEX CONCURRENTLY IF EXISTS ix_opportunities_keywords_gin"
        ))
        conn.execute(sa.text(
            "DROP INDEX CONCURRENTLY IF EXISTS ix_opportunities_thematic_areas_gin"
        ))
