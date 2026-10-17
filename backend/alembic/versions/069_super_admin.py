"""Platform super-admins.

`users.is_super_admin` is account-wide (not tied to an organization). Only
super-admins may manage the data every organization shares — funding sources,
funder organizations, the /admin maintenance endpoints — and only a
super-admin can make someone else one. Seeded with the platform owner.
"""
from alembic import op
import sqlalchemy as sa

revision = "069_super_admin"
down_revision = "068_archive_institution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_super_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE users SET is_super_admin = true WHERE lower(email) = 'tbrokowski@yahoo.com'")


def downgrade() -> None:
    op.drop_column("users", "is_super_admin")
