"""Scope the archive (and partners) to an organization.

Adds `grant_archives.institution_id`. Backfilled, in order, from the linked
grant's organization, then from the organization of whoever uploaded the
entry's documents. `partners.institution_id` already exists; rows still NULL
are backfilled from their owner's or creator's organization.

Whatever is still NULL afterwards is given to the only organization when there
is exactly one (a single-org install); otherwise it stays NULL and is visible
to nobody until an admin assigns it.

Archive clusters become per-organization (`archive_clusters.institution_id`).
The existing clusters and similarity edges were computed across every org's
entries, so they are dropped; the next clustering run rebuilds them per org.
"""
from alembic import op
import sqlalchemy as sa

revision = "068_archive_institution"
down_revision = "067_archive_shares"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "grant_archives",
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_grant_archives_institution_id", "grant_archives", ["institution_id"])

    op.execute(
        """
        UPDATE grant_archives ga SET institution_id = g.institution_id
        FROM active_grants g
        WHERE ga.grant_id = g.id AND ga.institution_id IS NULL AND g.institution_id IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE grant_archives ga SET institution_id = sub.institution_id
        FROM (
            SELECT DISTINCT ON (d.archive_id) d.archive_id, u.institution_id
            FROM documents d JOIN users u ON u.id = d.uploaded_by_id
            WHERE d.archive_id IS NOT NULL AND u.institution_id IS NOT NULL
            ORDER BY d.archive_id, d.uploaded_at
        ) sub
        WHERE ga.id = sub.archive_id AND ga.institution_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE partners p SET institution_id = u.institution_id
        FROM users u
        WHERE p.institution_id IS NULL AND u.id = COALESCE(p.owner_id, p.created_by)
          AND u.institution_id IS NOT NULL
        """
    )
    for table in ("grant_archives", "partners"):
        op.execute(
            f"""
            UPDATE {table} SET institution_id = (SELECT id FROM institutions LIMIT 1)
            WHERE institution_id IS NULL AND (SELECT count(*) FROM institutions) = 1
            """
        )


    op.execute("UPDATE grant_archives SET cluster_id = NULL, umap_x = NULL, umap_y = NULL")
    op.execute("DELETE FROM archive_edges")
    op.execute("DELETE FROM archive_clusters")
    op.add_column(
        "archive_clusters",
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_archive_clusters_institution_id", "archive_clusters", ["institution_id"])


def downgrade() -> None:
    op.drop_index("ix_archive_clusters_institution_id", table_name="archive_clusters")
    op.drop_column("archive_clusters", "institution_id")
    op.drop_index("ix_grant_archives_institution_id", table_name="grant_archives")
    op.drop_column("grant_archives", "institution_id")
