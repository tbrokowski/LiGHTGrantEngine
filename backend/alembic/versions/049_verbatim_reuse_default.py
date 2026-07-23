"""Make verbatim reuse the default for the institution's own archived proposals.

Existing archive-derived sections were indexed with text_reuse_allowed=false, so
the writer could only paraphrase them. The institution wants the writer to borrow
real sentences/phrasing from its own past grants, so flip archive-derived rows to
reuse-allowed and clear the paraphrase-only flag on archive-sourced language blocks.

Only touches rows tied to a grant archive (archive_id IS NOT NULL) — per-grant
workspace reference sections are already inserted reuse-allowed, and this leaves
any genuinely restricted external material untouched.
"""
from alembic import op
import sqlalchemy as sa

revision = "049_verbatim_reuse_default"
down_revision = "048_shortlist_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE proposal_sections SET text_reuse_allowed = true "
        "WHERE archive_id IS NOT NULL AND text_reuse_allowed = false"
    )
    op.execute(
        "UPDATE reusable_language_blocks SET paraphrase_only = false "
        "WHERE archive_id IS NOT NULL AND paraphrase_only = true "
        "AND do_not_reuse = false"
    )


def downgrade() -> None:
    # One-way data backfill; nothing to safely restore (we don't know which rows
    # were originally false vs. flipped). No-op on downgrade.
    pass
