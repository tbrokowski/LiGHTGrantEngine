"""Create org_join_requests table

Revision ID: 013
Revises: 012
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_join_requests",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("email", sa.String(300), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("reviewed_by_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_org_join_requests_institution_id", "org_join_requests", ["institution_id"])
    op.create_index("ix_org_join_requests_user_id", "org_join_requests", ["user_id"])
    op.create_index("ix_org_join_requests_status", "org_join_requests", ["status"])

    # Add access_code and access_code_expires_at to institutions for the access-code join flow
    op.add_column("institutions", sa.Column("access_code", sa.String(20), nullable=True))
    op.add_column("institutions", sa.Column("access_code_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("institutions", "access_code_expires_at")
    op.drop_column("institutions", "access_code")
    op.drop_index("ix_org_join_requests_status", "org_join_requests")
    op.drop_index("ix_org_join_requests_user_id", "org_join_requests")
    op.drop_index("ix_org_join_requests_institution_id", "org_join_requests")
    op.drop_table("org_join_requests")
