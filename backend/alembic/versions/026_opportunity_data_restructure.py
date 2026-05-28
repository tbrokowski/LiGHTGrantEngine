"""Opportunity data restructure — additive only, zero deletions.

Adds:
- institution_opportunities.assigned_reviewer_id
- user_opportunity_states.saved_at, pinned, dismissed_at, personal_notes, personal_tags

Data migration:
- Copies existing user_shortlists rows into user_opportunity_states.saved_at
  using an upsert so existing read_at values are preserved.

Nothing is dropped. All legacy columns on opportunities (fit_score, priority,
fit_rationale, status, assigned_reviewer_id) are left intact for backwards
compatibility.

Revision ID: 026
Revises: 025
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── institution_opportunities: add assigned_reviewer_id ───────────────────
    op.add_column(
        "institution_opportunities",
        sa.Column(
            "assigned_reviewer_id",
            sa.String(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )

    # ── user_opportunity_states: add interaction columns ──────────────────────
    op.add_column(
        "user_opportunity_states",
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_opportunity_states",
        sa.Column(
            "pinned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "user_opportunity_states",
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_opportunity_states",
        sa.Column("personal_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "user_opportunity_states",
        sa.Column(
            "personal_tags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )

    # ── Data migration: copy user_shortlists → user_opportunity_states ────────
    # Upsert: create a row if none exists, otherwise only update saved_at if
    # it is currently NULL (don't overwrite a row that was already set).
    op.execute(sa.text("""
        INSERT INTO user_opportunity_states (user_id, opportunity_id, saved_at)
        SELECT user_id, opportunity_id, added_at
        FROM user_shortlists
        ON CONFLICT (user_id, opportunity_id)
        DO UPDATE SET saved_at = EXCLUDED.saved_at
        WHERE user_opportunity_states.saved_at IS NULL
    """))


def downgrade() -> None:
    # Safe to drop the newly added columns only — all legacy data is untouched.
    op.drop_column("user_opportunity_states", "personal_tags")
    op.drop_column("user_opportunity_states", "personal_notes")
    op.drop_column("user_opportunity_states", "dismissed_at")
    op.drop_column("user_opportunity_states", "pinned")
    op.drop_column("user_opportunity_states", "saved_at")
    op.drop_column("institution_opportunities", "assigned_reviewer_id")
