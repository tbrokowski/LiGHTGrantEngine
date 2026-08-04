"""Per-user LLM API keys + usage ledger (multi-provider grant writing).

user_api_keys: a user's own OpenAI/Anthropic/Google key (encrypted at rest).
llm_usage: one row per tracked LLM call for per-provider/model cost reporting.
"""
from alembic import op
import sqlalchemy as sa

revision = "055_llm_keys_usage"
down_revision = "054_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_api_keys",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(length=30), nullable=False),
        sa.Column("encrypted_key", sa.String(length=2000), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_provider_key"),
    )
    op.create_index("ix_user_api_keys_user_id", "user_api_keys", ["user_id"])

    op.create_table(
        "llm_usage",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("grant_id", sa.String(), nullable=True),
        sa.Column("provider", sa.String(length=30), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=False),
        sa.Column("agent", sa.String(length=80), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_llm_usage_user_id", "llm_usage", ["user_id"])
    op.create_index("ix_llm_usage_grant_id", "llm_usage", ["grant_id"])
    op.create_index("ix_llm_usage_created_at", "llm_usage", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_llm_usage_created_at", table_name="llm_usage")
    op.drop_index("ix_llm_usage_grant_id", table_name="llm_usage")
    op.drop_index("ix_llm_usage_user_id", table_name="llm_usage")
    op.drop_table("llm_usage")
    op.drop_index("ix_user_api_keys_user_id", table_name="user_api_keys")
    op.drop_table("user_api_keys")
