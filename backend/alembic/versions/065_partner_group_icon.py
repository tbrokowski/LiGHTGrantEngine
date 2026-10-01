"""Partner groups: an icon or a logo.

`icon` names one of a fixed set of icons drawn in the group's color; `logo`
is a small uploaded image, resized in the browser to 128px and stored inline
as a data URL (a few KB) so it never expires and needs no object storage.
With neither, the group shows its initials.
"""
from alembic import op
import sqlalchemy as sa

revision = "065_partner_group_icon"
down_revision = "064_drop_from_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("partner_groups", sa.Column("icon", sa.String(40), nullable=True))
    op.add_column("partner_groups", sa.Column("logo", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("partner_groups", "logo")
    op.drop_column("partner_groups", "icon")
