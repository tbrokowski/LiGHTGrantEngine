"""Normalize grant_stage for grants whose status has moved past 'proposal'.

Historically the workspace status dropdown set active_grants.status directly
(e.g. to 'submitted'/'under_review') without updating grant_stage, so submitted
grants stayed in the "Proposals" tab (which filters on grant_stage='proposal').
The API now keeps the two in sync; this backfills the already-inconsistent rows
so they leave Proposals immediately.
"""
from alembic import op

revision = "047_sync_grant_stage_from_status"
down_revision = "046_funder_orgs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Submitted / under review / deferred → pending (out of Proposals)
    op.execute(
        """
        UPDATE active_grants
        SET grant_stage = 'pending'
        WHERE grant_stage = 'proposal'
          AND status IN ('submitted', 'under_review', 'deferred')
        """
    )
    # Awarded → active
    op.execute(
        """
        UPDATE active_grants
        SET grant_stage = 'active'
        WHERE grant_stage IN ('proposal', 'pending')
          AND status = 'awarded'
        """
    )
    # Terminal outcomes → archived
    op.execute(
        """
        UPDATE active_grants
        SET grant_stage = 'archived'
        WHERE grant_stage IN ('proposal', 'pending')
          AND status IN ('rejected', 'withdrawn', 'closed')
        """
    )


def downgrade() -> None:
    # One-way data normalization; nothing to reverse.
    pass
