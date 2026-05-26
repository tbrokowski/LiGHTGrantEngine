"""Initial schema with pgvector

Revision ID: 001
Revises:
Create Date: 2026-01-01

"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── users ─────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(300), nullable=False),
        sa.Column("hashed_password", sa.String(300)),
        sa.Column("role", sa.String(50), default="reviewer"),
        sa.Column("team", sa.String(200)),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("notification_preferences", sa.JSON(), default={}),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_login", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # ── sources ───────────────────────────────────────────
    op.create_table(
        "sources",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("category", sa.String(100)),
        sa.Column("url", sa.String(1000)),
        sa.Column("source_type", sa.String(50)),
        sa.Column("api_endpoint", sa.String(1000)),
        sa.Column("auth_required", sa.Boolean(), default=False),
        sa.Column("refresh_frequency", sa.String(50)),
        sa.Column("last_checked", sa.DateTime(timezone=True)),
        sa.Column("last_successful_run", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(50), default="active"),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("relevant_themes", sa.JSON(), default=[]),
        sa.Column("relevant_geographies", sa.JSON(), default=[]),
        sa.Column("parser_type", sa.String(100)),
        sa.Column("scraper_config", sa.JSON(), default={}),
        sa.Column("terms_of_use_notes", sa.Text()),
        sa.Column("robots_txt_notes", sa.Text()),
        sa.Column("error_log", sa.JSON(), default=[]),
        sa.Column("opportunities_discovered", sa.Integer(), default=0),
        sa.Column("opportunities_added", sa.Integer(), default=0),
        sa.Column("duplicates_detected", sa.Integer(), default=0),
        sa.Column("notes", sa.Text()),
        sa.Column("is_high_priority", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── source_runs ───────────────────────────────────────
    op.create_table(
        "source_runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("source_id", sa.String(), sa.ForeignKey("sources.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(50)),
        sa.Column("records_found", sa.Integer(), default=0),
        sa.Column("new_opportunities", sa.Integer(), default=0),
        sa.Column("updated_opportunities", sa.Integer(), default=0),
        sa.Column("duplicates", sa.Integer(), default=0),
        sa.Column("errors", sa.JSON(), default=[]),
        sa.Column("warnings", sa.JSON(), default=[]),
        sa.Column("log_summary", sa.Text()),
        sa.Column("raw_response_saved", sa.Boolean(), default=False),
        sa.Column("parser_version", sa.String(50)),
        sa.Column("notes", sa.Text()),
    )
    op.create_index("ix_source_runs_source_id", "source_runs", ["source_id"])

    # ── opportunities ─────────────────────────────────────
    op.create_table(
        "opportunities",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("funder", sa.String(300)),
        sa.Column("program_name", sa.String(300)),
        sa.Column("opportunity_number", sa.String(200)),
        sa.Column("source_id", sa.String(), sa.ForeignKey("sources.id")),
        sa.Column("source_url", sa.String(1000)),
        sa.Column("opportunity_url", sa.String(1000)),
        sa.Column("description", sa.Text()),
        sa.Column("short_summary", sa.Text()),
        sa.Column("ai_summary", sa.Text()),
        sa.Column("deadline", sa.Date()),
        sa.Column("opening_date", sa.Date()),
        sa.Column("loi_deadline", sa.Date()),
        sa.Column("concept_note_deadline", sa.Date()),
        sa.Column("full_proposal_deadline", sa.Date()),
        sa.Column("award_min", sa.Float()),
        sa.Column("award_max", sa.Float()),
        sa.Column("currency", sa.String(10)),
        sa.Column("total_funding_envelope", sa.Float()),
        sa.Column("expected_awards", sa.Integer()),
        sa.Column("project_duration", sa.String(100)),
        sa.Column("eligibility_criteria", sa.Text()),
        sa.Column("institutional_eligibility", sa.Text()),
        sa.Column("pi_eligibility", sa.Text()),
        sa.Column("geographic_eligibility", sa.Text()),
        sa.Column("partner_requirements", sa.Text()),
        sa.Column("cost_sharing_requirements", sa.Text()),
        sa.Column("indirect_cost_rules", sa.Text()),
        sa.Column("allowed_countries", sa.JSON(), default=[]),
        sa.Column("excluded_countries", sa.JSON(), default=[]),
        sa.Column("clinical_trial_allowed", sa.Boolean()),
        sa.Column("thematic_areas", sa.JSON(), default=[]),
        sa.Column("keywords", sa.JSON(), default=[]),
        sa.Column("geography", sa.JSON(), default=[]),
        sa.Column("funding_mechanism", sa.String(100)),
        sa.Column("submission_type", sa.String(100)),
        sa.Column("trl_level", sa.String(50)),
        sa.Column("submission_portal", sa.String(500)),
        sa.Column("required_documents", sa.JSON(), default=[]),
        sa.Column("evaluation_criteria", sa.Text()),
        sa.Column("page_limit", sa.Integer()),
        sa.Column("word_limit", sa.Integer()),
        sa.Column("language_requirements", sa.String(100)),
        sa.Column("data_sharing_requirements", sa.Text()),
        sa.Column("open_science_requirements", sa.Text()),
        sa.Column("ethics_requirements", sa.Text()),
        sa.Column("reporting_requirements", sa.Text()),
        sa.Column("contact_information", sa.Text()),
        sa.Column("prior_winners_link", sa.String(1000)),
        sa.Column("faq_link", sa.String(1000)),
        sa.Column("guidance_doc_link", sa.String(1000)),
        sa.Column("fit_score", sa.Float()),
        sa.Column("fit_rationale", sa.Text()),
        sa.Column("priority", sa.String(50)),
        sa.Column("status", sa.String(50), default="new"),
        sa.Column("duplicate_status", sa.String(50), default="unique"),
        sa.Column("assigned_reviewer_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("raw_text", sa.Text()),
        sa.Column("parsed_text", sa.Text()),
        sa.Column("embedding", Vector(1536)),
        sa.Column("date_discovered", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("date_updated", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("notes", sa.Text()),
    )
    op.create_index("ix_opportunities_title", "opportunities", ["title"])
    op.create_index("ix_opportunities_funder", "opportunities", ["funder"])
    op.create_index("ix_opportunities_status", "opportunities", ["status"])
    op.create_index("ix_opportunities_deadline", "opportunities", ["deadline"])
    op.create_index("ix_opportunities_fit_score", "opportunities", ["fit_score"])
    op.create_index("ix_opportunities_date_discovered", "opportunities", ["date_discovered"])

    # ── opportunity_reviews ───────────────────────────────
    op.create_table(
        "opportunity_reviews",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("opportunity_id", sa.String(), sa.ForeignKey("opportunities.id"), nullable=False),
        sa.Column("reviewer_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("review_status", sa.String(50)),
        sa.Column("recommendation", sa.String(50)),
        sa.Column("fit_comments", sa.Text()),
        sa.Column("eligibility_comments", sa.Text()),
        sa.Column("risk_notes", sa.Text()),
        sa.Column("decision", sa.String(50)),
        sa.Column("decision_reason", sa.String(100)),
        sa.Column("follow_up_actions", sa.Text()),
        sa.Column("review_date", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_opportunity_reviews_opp_id", "opportunity_reviews", ["opportunity_id"])

    # ── funder_profiles ───────────────────────────────────
    op.create_table(
        "funder_profiles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("website", sa.String(1000)),
        sa.Column("programs_tracked", sa.JSON(), default=[]),
        sa.Column("themes", sa.JSON(), default=[]),
        sa.Column("geographic_priorities", sa.JSON(), default=[]),
        sa.Column("typical_award_min", sa.Float()),
        sa.Column("typical_award_max", sa.Float()),
        sa.Column("typical_duration", sa.String(100)),
        sa.Column("eligibility_notes", sa.Text()),
        sa.Column("indirect_cost_rules", sa.Text()),
        sa.Column("common_evaluation_criteria", sa.Text()),
        sa.Column("reviewer_feedback_patterns", sa.Text()),
        sa.Column("known_contacts", sa.JSON(), default=[]),
        sa.Column("strategic_notes", sa.Text()),
        sa.Column("upcoming_cycles", sa.JSON(), default=[]),
        sa.Column("relationship_owner_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("ai_generated_profile", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_funder_profiles_name", "funder_profiles", ["name"], unique=True)

    # ── active_grants ─────────────────────────────────────
    op.create_table(
        "active_grants",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("opportunity_id", sa.String(), sa.ForeignKey("opportunities.id")),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("funder", sa.String(300)),
        sa.Column("program", sa.String(300)),
        sa.Column("call_url", sa.String(1000)),
        sa.Column("internal_lead_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("pi_name", sa.String(200)),
        sa.Column("co_pis", sa.JSON(), default=[]),
        sa.Column("proposal_team", sa.JSON(), default=[]),
        sa.Column("partner_institutions", sa.JSON(), default=[]),
        sa.Column("external_deadline", sa.Date()),
        sa.Column("internal_deadline", sa.Date()),
        sa.Column("concept_note_deadline", sa.Date()),
        sa.Column("budget_deadline", sa.Date()),
        sa.Column("partner_doc_deadline", sa.Date()),
        sa.Column("submission_portal_url", sa.String(1000)),
        sa.Column("drive_folder_url", sa.String(1000)),
        sa.Column("proposal_draft_url", sa.String(1000)),
        sa.Column("budget_url", sa.String(1000)),
        sa.Column("letters_folder_url", sa.String(1000)),
        sa.Column("partner_docs_url", sa.String(1000)),
        sa.Column("final_package_url", sa.String(1000)),
        sa.Column("status", sa.String(50), default="scoping"),
        sa.Column("priority", sa.String(50)),
        sa.Column("requested_amount", sa.Float()),
        sa.Column("currency", sa.String(10)),
        sa.Column("project_duration", sa.String(100)),
        sa.Column("themes", sa.JSON(), default=[]),
        sa.Column("geographies", sa.JSON(), default=[]),
        sa.Column("submission_type", sa.String(100)),
        sa.Column("decision_outcome", sa.String(100)),
        sa.Column("award_amount", sa.Float()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_active_grants_status", "active_grants", ["status"])
    op.create_index("ix_active_grants_deadline", "active_grants", ["external_deadline"])

    # ── tasks ─────────────────────────────────────────────
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("reviewer_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("due_date", sa.Date()),
        sa.Column("priority", sa.String(50), default="medium"),
        sa.Column("status", sa.String(50), default="not_started"),
        sa.Column("task_type", sa.String(100)),
        sa.Column("dependencies", sa.JSON(), default=[]),
        sa.Column("document_url", sa.String(1000)),
        sa.Column("reminder_settings", sa.JSON(), default={}),
        sa.Column("created_by_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_tasks_grant_id", "tasks", ["grant_id"])
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_due_date", "tasks", ["due_date"])

    # ── grant_archives ────────────────────────────────────
    op.create_table(
        "grant_archives",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("opportunity_id", sa.String(), sa.ForeignKey("opportunities.id")),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id")),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("funder", sa.String(300)),
        sa.Column("program", sa.String(300)),
        sa.Column("call_year", sa.Integer()),
        sa.Column("submission_cycle", sa.String(100)),
        sa.Column("lead_pi", sa.String(200)),
        sa.Column("co_pis", sa.JSON(), default=[]),
        sa.Column("team_members", sa.JSON(), default=[]),
        sa.Column("partner_institutions", sa.JSON(), default=[]),
        sa.Column("themes", sa.JSON(), default=[]),
        sa.Column("geographies", sa.JSON(), default=[]),
        sa.Column("submitted", sa.Boolean(), default=False),
        sa.Column("submission_date", sa.Date()),
        sa.Column("outcome", sa.String(50)),
        sa.Column("decision_date", sa.Date()),
        sa.Column("requested_amount", sa.Float()),
        sa.Column("awarded_amount", sa.Float()),
        sa.Column("currency", sa.String(10)),
        sa.Column("project_duration", sa.String(100)),
        sa.Column("repository_folder_url", sa.String(1000)),
        sa.Column("access_level", sa.String(50), default="team_only"),
        sa.Column("ai_retrieval_allowed", sa.Boolean(), default=True),
        sa.Column("text_reuse_allowed", sa.Boolean(), default=False),
        sa.Column("lessons_learned", sa.Text()),
        sa.Column("internal_debrief", sa.Text()),
        sa.Column("reviewer_feedback", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_grant_archives_funder", "grant_archives", ["funder"])

    # ── documents ─────────────────────────────────────────
    op.create_table(
        "documents",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("opportunity_id", sa.String(), sa.ForeignKey("opportunities.id")),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id")),
        sa.Column("archive_id", sa.String(), sa.ForeignKey("grant_archives.id")),
        sa.Column("document_type", sa.String(100)),
        sa.Column("file_name", sa.String(500)),
        sa.Column("file_url", sa.String(1000)),
        sa.Column("file_format", sa.String(50)),
        sa.Column("version", sa.String(50)),
        sa.Column("uploaded_by_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("parsed_text", sa.Text()),
        sa.Column("processing_status", sa.String(50), default="not_processed"),
        sa.Column("access_level", sa.String(50), default="team_only"),
        sa.Column("ai_retrieval_allowed", sa.Boolean(), default=True),
        sa.Column("text_reuse_allowed", sa.Boolean(), default=False),
        sa.Column("last_parsed_at", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.Text()),
        sa.Column("embedding", Vector(1536)),
    )

    # ── proposal_sections ─────────────────────────────────
    op.create_table(
        "proposal_sections",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("document_id", sa.String(), sa.ForeignKey("documents.id")),
        sa.Column("archive_id", sa.String(), sa.ForeignKey("grant_archives.id")),
        sa.Column("grant_title", sa.String(500)),
        sa.Column("funder", sa.String(300)),
        sa.Column("year", sa.Integer()),
        sa.Column("outcome", sa.String(50)),
        sa.Column("section_type", sa.String(100)),
        sa.Column("section_title", sa.String(500)),
        sa.Column("section_text", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer()),
        sa.Column("page_count", sa.Float()),
        sa.Column("tags", sa.JSON(), default=[]),
        sa.Column("themes", sa.JSON(), default=[]),
        sa.Column("geography", sa.JSON(), default=[]),
        sa.Column("quality_rating", sa.Integer()),
        sa.Column("reusable_status", sa.Boolean(), default=False),
        sa.Column("ai_retrieval_allowed", sa.Boolean(), default=True),
        sa.Column("text_reuse_allowed", sa.Boolean(), default=False),
        sa.Column("paraphrase_allowed", sa.Boolean(), default=True),
        sa.Column("contains_confidential", sa.Boolean(), default=False),
        sa.Column("contains_pii", sa.Boolean(), default=False),
        sa.Column("is_outdated", sa.Boolean(), default=False),
        sa.Column("last_reviewed", sa.DateTime(timezone=True)),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("notes", sa.Text()),
        sa.Column("embedding", Vector(1536)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_sections_section_type", "proposal_sections", ["section_type"])
    op.create_index("ix_sections_funder", "proposal_sections", ["funder"])
    op.create_index("ix_sections_outcome", "proposal_sections", ["outcome"])

    # ── reusable_language_blocks ──────────────────────────
    op.create_table(
        "reusable_language_blocks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("source_grant", sa.String(500)),
        sa.Column("source_section", sa.String(100)),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("section_type", sa.String(100)),
        sa.Column("tags", sa.JSON(), default=[]),
        sa.Column("approved_for_reuse", sa.Boolean(), default=False),
        sa.Column("approved_by_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("paraphrase_only", sa.Boolean(), default=False),
        sa.Column("restricted_to_team", sa.Boolean(), default=False),
        sa.Column("restricted_to_funder", sa.String(300)),
        sa.Column("do_not_reuse", sa.Boolean(), default=False),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("last_reviewed", sa.DateTime(timezone=True)),
        sa.Column("review_date", sa.Date()),
        sa.Column("access_level", sa.String(50), default="team_only"),
        sa.Column("usage_notes", sa.Text()),
        sa.Column("do_not_use_notes", sa.Text()),
        sa.Column("version", sa.String(50)),
        sa.Column("embedding", Vector(1536)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── comments ──────────────────────────────────────────
    op.create_table(
        "comments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("author_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("mentions", sa.JSON(), default=[]),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_comments_entity_id", "comments", ["entity_id"])

    # ── notifications ─────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("notification_type", sa.String(100)),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String()),
        sa.Column("message", sa.Text()),
        sa.Column("channel", sa.String(50)),
        sa.Column("status", sa.String(50), default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])

    # ── ai_runs ───────────────────────────────────────────
    op.create_table(
        "ai_runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id")),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String()),
        sa.Column("agent_type", sa.String(100)),
        sa.Column("prompt_type", sa.String(100)),
        sa.Column("sources_retrieved", sa.JSON(), default=[]),
        sa.Column("output", sa.Text()),
        sa.Column("output_structured", sa.JSON(), default={}),
        sa.Column("status", sa.String(50), default="running"),
        sa.Column("warnings", sa.JSON(), default=[]),
        sa.Column("model_used", sa.String(200)),
        sa.Column("tokens_used", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    for table in [
        "ai_runs", "notifications", "comments",
        "reusable_language_blocks", "proposal_sections", "documents",
        "grant_archives", "tasks", "active_grants", "funder_profiles",
        "opportunity_reviews", "opportunities", "source_runs", "sources", "users",
    ]:
        op.drop_table(table)
    op.execute("DROP EXTENSION IF EXISTS vector")
