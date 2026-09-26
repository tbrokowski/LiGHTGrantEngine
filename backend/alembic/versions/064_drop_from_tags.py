"""Partners: move "from:<institution>" tags into the Institution field.

Where someone is from is the partner's organization (shown as Institution),
not a tag. Research used to add a "from:<organization>" tag and the partner
form had a "Where they're from" facet; both are gone. For each partner, a
from: value fills organization when it's empty, then every from: tag is
removed.
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "064_drop_from_tags"
down_revision = "063_partner_groups"
branch_labels = None
depends_on = None


def _as_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            v = json.loads(value)
            return v if isinstance(v, list) else []
        except ValueError:
            return []
    return []


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, organization, tags FROM partners WHERE CAST(tags AS text) LIKE '%from:%'"
    )).mappings().all()
    for r in rows:
        tags = _as_list(r["tags"])
        froms = [str(t)[5:].strip() for t in tags if str(t).startswith("from:") and str(t)[5:].strip()]
        kept = [t for t in tags if not str(t).startswith("from:")]
        if len(kept) == len(tags):
            continue
        org = r["organization"]
        if not (org or "").strip() and froms:
            org = froms[0][:300]
        conn.execute(
            sa.text("UPDATE partners SET tags = CAST(:tags AS json), organization = :org WHERE id = :id"),
            {"tags": json.dumps(kept), "org": org, "id": r["id"]},
        )


def downgrade() -> None:
    # Which tags were removed isn't recorded; the institutions stay filled in.
    pass
