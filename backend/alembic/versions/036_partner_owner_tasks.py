"""Partner CRM: owner_id on partners + partner_tasks table.

Revision ID: 036
Revises: 035
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add owner_id to partners
    op.add_column("partners", sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True))
    op.create_index("ix_partners_owner_id", "partners", ["owner_id"])

    # Create partner_tasks table
    op.create_table(
        "partner_tasks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_to", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_tasks_partner_id", "partner_tasks", ["partner_id"])
    op.create_index("ix_partner_tasks_assigned_to", "partner_tasks", ["assigned_to"])
    op.create_index("ix_partner_tasks_status", "partner_tasks", ["status"])


def downgrade() -> None:
    op.drop_index("ix_partner_tasks_status", "partner_tasks")
    op.drop_index("ix_partner_tasks_assigned_to", "partner_tasks")
    op.drop_index("ix_partner_tasks_partner_id", "partner_tasks")
    op.drop_table("partner_tasks")
    op.drop_index("ix_partners_owner_id", "partners")
    op.drop_column("partners", "owner_id")
