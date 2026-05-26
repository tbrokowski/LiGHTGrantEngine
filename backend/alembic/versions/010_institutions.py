"""Institutions + user institution FK

Revision ID: 010
Revises: 009
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "institutions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("domain", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_institutions_name", "institutions", ["name"])
    op.create_index("ix_institutions_domain", "institutions", ["domain"])

    op.add_column("users", sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=True))
    op.add_column("users", sa.Column("institution_role", sa.String(50), nullable=False, server_default="member"))
    op.create_index("ix_users_institution_id", "users", ["institution_id"])


def downgrade() -> None:
    op.drop_index("ix_users_institution_id", "users")
    op.drop_column("users", "institution_role")
    op.drop_column("users", "institution_id")
    op.drop_index("ix_institutions_domain", "institutions")
    op.drop_index("ix_institutions_name", "institutions")
    op.drop_table("institutions")
