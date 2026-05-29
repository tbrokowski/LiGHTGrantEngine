"""Grant finance: ledgers, categories, fund requests, expenditures, slack config.

Revision ID: 039
Revises: 038
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grant_ledgers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False, unique=True),
        sa.Column("total_awarded", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_grant_ledgers_grant_id", "grant_ledgers", ["grant_id"])

    op.create_table(
        "ledger_categories",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("ledger_id", sa.String(), sa.ForeignKey("grant_ledgers.id"), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("approved_amount", sa.Float(), server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ledger_categories_ledger_id", "ledger_categories", ["ledger_id"])

    op.create_table(
        "fund_requests",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("category_id", sa.String(), sa.ForeignKey("ledger_categories.id"), nullable=True),
        sa.Column("requested_by_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("vendor", sa.String(300), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("status", sa.String(50), server_default="pending"),
        sa.Column("slack_message_ts", sa.String(50), nullable=True),
        sa.Column("slack_channel_id", sa.String(50), nullable=True),
        sa.Column("approved_by_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("attachments", sa.JSON(), server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_fund_requests_grant_id", "fund_requests", ["grant_id"])
    op.create_index("ix_fund_requests_category_id", "fund_requests", ["category_id"])
    op.create_index("ix_fund_requests_status", "fund_requests", ["status"])

    op.create_table(
        "expenditures",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False),
        sa.Column("category_id", sa.String(), sa.ForeignKey("ledger_categories.id"), nullable=True),
        sa.Column("fund_request_id", sa.String(), sa.ForeignKey("fund_requests.id"), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("expense_date", sa.Date(), nullable=True),
        sa.Column("vendor", sa.String(300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("receipt_url", sa.String(1000), nullable=True),
        sa.Column("recorded_by_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_expenditures_grant_id", "expenditures", ["grant_id"])
    op.create_index("ix_expenditures_category_id", "expenditures", ["category_id"])

    op.create_table(
        "slack_grant_configs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("grant_id", sa.String(), sa.ForeignKey("active_grants.id"), nullable=False, unique=True),
        sa.Column("slack_team_id", sa.String(50), nullable=True),
        sa.Column("slack_channel_id", sa.String(50), nullable=False),
        sa.Column("slack_channel_name", sa.String(200), nullable=True),
        sa.Column("slack_bot_token", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_slack_grant_configs_grant_id", "slack_grant_configs", ["grant_id"])


def downgrade() -> None:
    op.drop_table("slack_grant_configs")
    op.drop_table("expenditures")
    op.drop_table("fund_requests")
    op.drop_table("ledger_categories")
    op.drop_table("grant_ledgers")
