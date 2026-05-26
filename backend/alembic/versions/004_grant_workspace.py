"""Add grant management workspace tables

Revision ID: 004
Revises: 003
Create Date: 2026-05-13

"""
from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Extend tasks ──────────────────────────────────────────────────────────
    op.add_column("tasks", sa.Column("parent_task_id", sa.String(), sa.ForeignKey("tasks.id"), nullable=True))
    op.add_column("tasks", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("tasks", sa.Column("estimated_effort", sa.Float(), nullable=True))
    op.add_column("tasks", sa.Column("linked_section_id", sa.String(), nullable=True))
    op.add_column("tasks", sa.Column("linked_milestone_id", sa.String(), nullable=True))
    op.create_index("ix_tasks_parent_task_id", "tasks", ["parent_task_id"])

    # ── milestones ────────────────────────────────────────────────────────────
    op.create_table(
        "milestones",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("completion_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(50), default="upcoming"),
        sa.Column("linked_tasks", sa.JSON(), default=[]),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_milestones_grant_id", "milestones", ["grant_id"])

    # ── gantt_items ───────────────────────────────────────────────────────────
    op.create_table(
        "gantt_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("linked_task_id", sa.String(), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("linked_milestone_id", sa.String(), sa.ForeignKey("milestones.id"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("item_type", sa.String(50), default="task"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(50), default="not_started"),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("dependency_ids", sa.JSON(), default=[]),
        sa.Column("display_order", sa.Integer(), default=0),
        sa.Column("color_category", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_gantt_items_grant_id", "gantt_items", ["grant_id"])

    # ── workspace_sections ────────────────────────────────────────────────────
    op.create_table(
        "workspace_sections",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("section_type", sa.String(100), default="other"),
        sa.Column("requirement_text", sa.Text(), nullable=True),
        sa.Column("word_limit", sa.Integer(), nullable=True),
        sa.Column("page_limit", sa.Float(), nullable=True),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewer_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(50), default="not_started"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("linked_document_url", sa.String(1000), nullable=True),
        sa.Column("current_word_count", sa.Integer(), default=0),
        sa.Column("compliance_status", sa.String(50), default="unchecked"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_workspace_sections_grant_id", "workspace_sections", ["grant_id"])

    # ── checklist_items ───────────────────────────────────────────────────────
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(100), default="general"),
        sa.Column("required", sa.Boolean(), default=True),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(50), default="not_started"),
        sa.Column("linked_document_url", sa.String(1000), nullable=True),
        sa.Column("evidence_url", sa.String(1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_checklist_items_grant_id", "checklist_items", ["grant_id"])

    # ── workspace_files ───────────────────────────────────────────────────────
    op.create_table(
        "workspace_files",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=False),
        sa.Column("file_type", sa.String(100), nullable=True),
        sa.Column("file_category", sa.String(100), default="other"),
        sa.Column("file_url", sa.String(1000), nullable=False),
        sa.Column("source_type", sa.String(50), default="uploaded"),
        sa.Column("version", sa.String(50), default="1"),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("access_level", sa.String(50), default="team"),
        sa.Column("ai_retrieval_allowed", sa.Boolean(), default=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), default=[]),
        sa.Column("related_task_id", sa.String(), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("related_section_id", sa.String(), sa.ForeignKey("workspace_sections.id"), nullable=True),
        sa.Column("uploaded_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_workspace_files_grant_id", "workspace_files", ["grant_id"])

    # ── workspace_partners ────────────────────────────────────────────────────
    op.create_table(
        "workspace_partners",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("institution_name", sa.String(300), nullable=False),
        sa.Column("contact_person", sa.String(200), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("role", sa.String(200), nullable=True),
        sa.Column("status", sa.String(50), default="not_contacted"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_workspace_partners_grant_id", "workspace_partners", ["grant_id"])

    # ── partner_materials ─────────────────────────────────────────────────────
    op.create_table(
        "partner_materials",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("workspace_partners.id"), nullable=False),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("material_type", sa.String(100), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(50), default="not_requested"),
        sa.Column("linked_file_url", sa.String(1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_partner_materials_partner_id", "partner_materials", ["partner_id"])
    op.create_index("ix_partner_materials_grant_id", "partner_materials", ["grant_id"])

    # ── budget_tracker ────────────────────────────────────────────────────────
    op.create_table(
        "budget_tracker",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False, unique=True),
        sa.Column("requested_amount", sa.Float(), nullable=True),
        sa.Column("maximum_amount", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(10), default="USD"),
        sa.Column("budget_owner_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(50), default="not_started"),
        sa.Column("spreadsheet_url", sa.String(1000), nullable=True),
        sa.Column("justification_url", sa.String(1000), nullable=True),
        sa.Column("indirect_cost_rule", sa.Text(), nullable=True),
        sa.Column("cost_share_required", sa.Boolean(), default=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── grant_activity_log ────────────────────────────────────────────────────
    op.create_table(
        "grant_activity_log",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=True),
        sa.Column("entity_id", sa.String(), nullable=True),
        sa.Column("action", sa.String(200), nullable=False),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_grant_activity_log_grant_id", "grant_activity_log", ["grant_id"])
    op.create_index("ix_grant_activity_log_timestamp", "grant_activity_log", ["timestamp"])


def downgrade() -> None:
    op.drop_table("grant_activity_log")
    op.drop_table("budget_tracker")
    op.drop_table("partner_materials")
    op.drop_table("workspace_partners")
    op.drop_table("workspace_files")
    op.drop_table("checklist_items")
    op.drop_table("workspace_sections")
    op.drop_table("gantt_items")
    op.drop_table("milestones")

    op.drop_index("ix_tasks_parent_task_id", "tasks")
    op.drop_column("tasks", "linked_milestone_id")
    op.drop_column("tasks", "linked_section_id")
    op.drop_column("tasks", "estimated_effort")
    op.drop_column("tasks", "start_date")
    op.drop_column("tasks", "parent_task_id")
