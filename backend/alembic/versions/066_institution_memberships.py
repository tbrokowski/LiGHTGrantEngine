"""Users can belong to several organizations.

`institution_memberships` holds one row per (user, organization). The
membership columns on `users` stay and mirror the *active* membership, so code
that reads `current_user.institution_id` keeps working. Backfilled from every
user's current organization.

Also: `institutions.access_code_role` (the role an access code grants) and
`users.token_version` (bumped to sign out other sessions).
"""
from alembic import op
import sqlalchemy as sa

revision = "066_institution_memberships"
down_revision = "065_partner_group_icon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "institution_memberships",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("institution_role", sa.String(50), nullable=False, server_default="member"),
        sa.Column("role", sa.String(50), nullable=False, server_default="contributor"),
        sa.Column("module_permissions", sa.JSON(), server_default="{}"),
        sa.Column("joined_via", sa.String(20)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "institution_id", name="uq_membership_user_institution"),
    )
    op.create_index("ix_institution_memberships_user_id", "institution_memberships", ["user_id"])
    op.create_index("ix_institution_memberships_institution_id", "institution_memberships", ["institution_id"])

    op.execute(
        """
        INSERT INTO institution_memberships
            (id, user_id, institution_id, institution_role, role, module_permissions, joined_via, created_at)
        SELECT gen_random_uuid()::text, id, institution_id,
               COALESCE(institution_role, 'member'), COALESCE(role, 'contributor'),
               COALESCE(module_permissions::json, '{}'::json), 'backfill', COALESCE(created_at, now())
        FROM users
        WHERE institution_id IS NOT NULL
        """
    )

    op.add_column("institutions", sa.Column("access_code_role", sa.String(50), nullable=True))
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "token_version")
    op.drop_column("institutions", "access_code_role")
    op.drop_index("ix_institution_memberships_institution_id", table_name="institution_memberships")
    op.drop_index("ix_institution_memberships_user_id", table_name="institution_memberships")
    op.drop_table("institution_memberships")
