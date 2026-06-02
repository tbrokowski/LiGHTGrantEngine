"""Pause NIH RePORTER and NSF Award Search sources; disable at institution level."""

from alembic import op

revision = "041_pause_award_sources"
down_revision = "040_document_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE sources
        SET status = 'paused', is_high_priority = false
        WHERE source_type IN ('nih_reporter', 'nsf')
        """
    )
    op.execute(
        """
        UPDATE institution_sources
        SET is_enabled = false
        WHERE source_id IN (
            SELECT id FROM sources WHERE source_type IN ('nih_reporter', 'nsf')
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE sources
        SET status = 'active', is_high_priority = true
        WHERE source_type IN ('nih_reporter', 'nsf')
        """
    )
    op.execute(
        """
        UPDATE institution_sources
        SET is_enabled = true
        WHERE source_id IN (
            SELECT id FROM sources WHERE source_type IN ('nih_reporter', 'nsf')
        )
        """
    )
