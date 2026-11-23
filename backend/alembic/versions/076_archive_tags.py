"""Archive Insights: org-scoped tags on archived grants, and saved views."""
from alembic import op
import sqlalchemy as sa

revision = "076_archive_tags"
down_revision = "075_writing_doc_main"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "archive_tags",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("group_name", sa.String(80), nullable=False, server_default=""),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("created_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("institution_id", "group_name", "name", name="uq_archive_tag_org_group_name"),
    )
    op.create_index("ix_archive_tags_institution_id", "archive_tags", ["institution_id"])

    op.create_table(
        "archive_tag_links",
        sa.Column("archive_id", sa.String(), sa.ForeignKey("grant_archives.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.String(), sa.ForeignKey("archive_tags.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_archive_tag_links_tag_id", "archive_tag_links", ["tag_id"])

    op.create_table(
        "archive_insight_views",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_archive_insight_views_institution_id", "archive_insight_views", ["institution_id"])


def downgrade() -> None:
    op.drop_index("ix_archive_insight_views_institution_id", table_name="archive_insight_views")
    op.drop_table("archive_insight_views")
    op.drop_index("ix_archive_tag_links_tag_id", table_name="archive_tag_links")
    op.drop_table("archive_tag_links")
    op.drop_index("ix_archive_tags_institution_id", table_name="archive_tags")
    op.drop_table("archive_tags")
