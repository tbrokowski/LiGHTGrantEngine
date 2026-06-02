"""Add draft_execution_plan and draft_qa_report to active_grants."""

from alembic import op
import sqlalchemy as sa

revision = "039_draft_execution_plan"
down_revision = "038_call_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("draft_execution_plan", sa.JSON(), nullable=True))
    op.add_column("active_grants", sa.Column("draft_qa_report", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "draft_qa_report")
    op.drop_column("active_grants", "draft_execution_plan")
