"""Add document_constraints JSON column for verified limits and section budgets."""

from alembic import op
import sqlalchemy as sa

revision = "040_document_constraints"
down_revision = "039_draft_execution_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("active_grants", sa.Column("document_constraints", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("active_grants", "document_constraints")
