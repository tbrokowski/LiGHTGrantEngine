"""Mark permanently unfetchable opportunities so they stop being re-queued.

Sets parsed_text = '[fetch_failed]' for opportunities whose URL matches
known-permanent-failure patterns (UKRI GtR past-award refs, bare EC portal
homepage, etc.) and have never been successfully enriched.

Revision ID: 035
Revises: 034
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None

# URL patterns that will never return usable grant content
_DEAD_URL_PATTERNS = [
    # UKRI Gateway to Research — past awarded project refs, not open calls
    "gtr.ukri.org/projects?ref=",
    # EC portal homepage — generic landing page, not a specific call
    "ec.europa.eu/info/funding-tenders",
]


def upgrade() -> None:
    conn = op.get_bind()
    for pattern in _DEAD_URL_PATTERNS:
        result = conn.execute(
            sa.text(
                "UPDATE opportunities "
                "SET parsed_text = '[fetch_failed]' "
                "WHERE parsed_text IS NULL "
                "  AND opportunity_url LIKE :pattern"
            ),
            {"pattern": f"%{pattern}%"},
        )
        print(f"Marked {result.rowcount} opportunities as fetch_failed for pattern: {pattern}")


def downgrade() -> None:
    # Reverse: clear the sentinel for these patterns only
    conn = op.get_bind()
    for pattern in _DEAD_URL_PATTERNS:
        conn.execute(
            sa.text(
                "UPDATE opportunities "
                "SET parsed_text = NULL "
                "WHERE parsed_text = '[fetch_failed]' "
                "  AND opportunity_url LIKE :pattern"
            ),
            {"pattern": f"%{pattern}%"},
        )
