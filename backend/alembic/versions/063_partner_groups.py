"""Partner CRM: priority, groups, and tasks on groups.

- partners.priority: 1 (regular) – 3 (high), shown as a column and used to rank
  reach-out suggestions. partners.snoozed_until hides someone from those
  suggestions for a while.
- partner_groups / partner_group_members: named sets of partners (a site, a
  consortium, a project). A partner can be in several groups.
- partner_tasks can now belong to a group instead of a partner — exactly one
  of partner_id / group_id is set.
- The unused `project_types` lists become groups, one per distinct value per
  institution, so nothing already typed there is lost. The column stays for
  now and is dropped in a later migration.
"""
import json
import uuid

from alembic import op
import sqlalchemy as sa

revision = "063_partner_groups"
down_revision = "062_partner_bio"
branch_labels = None
depends_on = None

_COLORS = ["#0F766E", "#1D4ED8", "#C2410C", "#6D28D9", "#15803D", "#BE123C", "#475569", "#A16207"]


def upgrade() -> None:
    op.add_column("partners", sa.Column("priority", sa.Integer(), nullable=False, server_default="1"))
    op.create_index("ix_partners_priority", "partners", ["priority"])
    op.add_column("partners", sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "partner_groups",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("institution_id", sa.String(), sa.ForeignKey("institutions.id"), nullable=True, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("institution_id", "name", name="uq_partner_groups_institution_name"),
    )
    op.create_table(
        "partner_group_members",
        sa.Column("group_id", sa.String(), sa.ForeignKey("partner_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("partner_id", sa.String(), sa.ForeignKey("partners.id", ondelete="CASCADE"), primary_key=True, index=True),
        sa.Column("added_by", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.add_column("partner_tasks", sa.Column(
        "group_id", sa.String(), sa.ForeignKey("partner_groups.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_partner_tasks_group_id", "partner_tasks", ["group_id"])
    op.alter_column("partner_tasks", "partner_id", existing_type=sa.String(), nullable=True)
    op.create_check_constraint(
        "ck_partner_tasks_one_owner", "partner_tasks", "(partner_id IS NULL) <> (group_id IS NULL)")

    # project_types → groups
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, institution_id, project_types FROM partners WHERE project_types IS NOT NULL"
    )).mappings().all()
    groups: dict[tuple, str] = {}
    for r in rows:
        values = r["project_types"]
        if isinstance(values, str):
            try:
                values = json.loads(values)
            except ValueError:
                values = []
        for raw in values or []:
            name = str(raw).strip()[:200]
            if not name:
                continue
            key = (r["institution_id"], name.lower())
            if key not in groups:
                gid = str(uuid.uuid4())
                groups[key] = gid
                conn.execute(sa.text(
                    "INSERT INTO partner_groups (id, institution_id, name, color, created_at, updated_at) "
                    "VALUES (:id, :inst, :name, :color, NOW(), NOW())"
                ), {"id": gid, "inst": r["institution_id"], "name": name,
                    "color": _COLORS[(len(groups) - 1) % len(_COLORS)]})
            conn.execute(sa.text(
                "INSERT INTO partner_group_members (group_id, partner_id, added_at) "
                "VALUES (:g, :p, NOW()) ON CONFLICT DO NOTHING"
            ), {"g": groups[key], "p": r["id"]})


def downgrade() -> None:
    op.execute("DELETE FROM partner_tasks WHERE group_id IS NOT NULL")
    op.drop_constraint("ck_partner_tasks_one_owner", "partner_tasks", type_="check")
    op.alter_column("partner_tasks", "partner_id", existing_type=sa.String(), nullable=False)
    op.drop_index("ix_partner_tasks_group_id", "partner_tasks")
    op.drop_column("partner_tasks", "group_id")
    op.drop_table("partner_group_members")
    op.drop_table("partner_groups")
    op.drop_column("partners", "snoozed_until")
    op.drop_index("ix_partners_priority", "partners")
    op.drop_column("partners", "priority")
