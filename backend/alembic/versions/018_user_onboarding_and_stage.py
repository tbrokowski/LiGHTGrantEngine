"""Add user/institution onboarding fields, email verification, grant_stage, AI billing."""
from alembic import op
import sqlalchemy as sa

revision = "018"
down_revision = "017_archive_indexing_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users: onboarding + email verification + AI billing ──────────────────
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("email_verification_token", sa.String(200), nullable=True))
    op.add_column("users", sa.Column("onboarding_complete", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("ai_usage_cents", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("ai_usage_limit_cents", sa.Integer(), nullable=False, server_default="300"))

    # ── institutions: onboarding + AI budget ─────────────────────────────────
    op.add_column("institutions", sa.Column("onboarding_complete", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("institutions", sa.Column("ai_budget_cents", sa.Integer(), nullable=True))

    # ── active_grants: pipeline stage ────────────────────────────────────────
    op.add_column("active_grants", sa.Column("grant_stage", sa.String(30), nullable=False, server_default="proposal"))
    op.add_column("active_grants", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("active_grants", sa.Column("decision_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("active_grants", sa.Column("stage_notes", sa.Text(), nullable=True))
    op.add_column("active_grants", sa.Column("reporting_deadlines", sa.JSON(), nullable=True))

    # ── ai_runs: cost tracking ────────────────────────────────────────────────
    op.add_column("ai_runs", sa.Column("cost_cents", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ai_runs", sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ai_runs", sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"))

    # ── email_verifications table ─────────────────────────────────────────────
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("token", sa.String(200), nullable=False, unique=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── opportunity_clusters table ────────────────────────────────────────────
    op.create_table(
        "opportunity_clusters",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column("opportunities", sa.Column("cluster_id", sa.Integer(), sa.ForeignKey("opportunity_clusters.id"), nullable=True))

    # ── milestones: work package grouping ─────────────────────────────────────
    op.add_column("milestones", sa.Column("work_package", sa.String(300), nullable=True))

    # ── users: google oauth tokens ────────────────────────────────────────────
    op.add_column("users", sa.Column("google_access_token", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("google_refresh_token", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("google_token_expiry", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "google_token_expiry")
    op.drop_column("users", "google_refresh_token")
    op.drop_column("users", "google_access_token")
    op.drop_column("milestones", "work_package")
    op.drop_column("opportunities", "cluster_id")
    op.drop_table("opportunity_clusters")
    op.drop_table("email_verifications")
    op.drop_column("ai_runs", "completion_tokens")
    op.drop_column("ai_runs", "prompt_tokens")
    op.drop_column("ai_runs", "cost_cents")
    op.drop_column("active_grants", "reporting_deadlines")
    op.drop_column("active_grants", "stage_notes")
    op.drop_column("active_grants", "decision_at")
    op.drop_column("active_grants", "submitted_at")
    op.drop_column("active_grants", "grant_stage")
    op.drop_column("institutions", "ai_budget_cents")
    op.drop_column("institutions", "onboarding_complete")
    op.drop_column("users", "ai_usage_limit_cents")
    op.drop_column("users", "ai_usage_cents")
    op.drop_column("users", "onboarding_complete")
    op.drop_column("users", "email_verification_token")
    op.drop_column("users", "email_verified")
