"""Share archived grants with people (by email or from Partners).

One row per (archive entry, recipient email). `is_internal` records whether the
recipient was in the sharer's organization when it was shared.
"""
from alembic import op
import sqlalchemy as sa

revision = "067_archive_shares"
down_revision = "066_institution_memberships"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "archive_shares",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("archive_id", sa.String(), sa.ForeignKey("grant_archives.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(300), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="SET NULL")),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="SET NULL")),
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("note", sa.Text()),
        sa.Column("shared_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("archive_id", "email", name="uq_archive_share_email"),
    )
    op.create_index("ix_archive_shares_archive_id", "archive_shares", ["archive_id"])
    op.create_index("ix_archive_shares_email", "archive_shares", ["email"])
    op.create_index("ix_archive_shares_user_id", "archive_shares", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_archive_shares_user_id", table_name="archive_shares")
    op.drop_index("ix_archive_shares_email", table_name="archive_shares")
    op.drop_index("ix_archive_shares_archive_id", table_name="archive_shares")
    op.drop_table("archive_shares")
