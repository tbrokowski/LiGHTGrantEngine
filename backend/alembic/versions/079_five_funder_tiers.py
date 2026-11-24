"""Fold the ten funder tiers into five.

Blue Whales now cover all wealth holders (the old Whale Pods, Whale Calves and
Matriarchs join them); Sperm Whales take in Humpbacks and Orcas; Pilot Fish
join Sharks. Whale Pods are reused for philanthropic organizations, so the
families that held that key move to Blue Whales first. Dolphins and Sharks
keep their people.

Revision ID: 079_five_funder_tiers
Revises: 078_funder_threads
"""
from alembic import op

revision = "079_five_funder_tiers"
down_revision = "078_funder_threads"
branch_labels = None
depends_on = None

# Order matters: whale_pod is emptied before anyone is moved into it.
MOVES = (
    ("whale_pod", "blue_whale"),
    ("whale_calf", "blue_whale"),
    ("matriarch", "blue_whale"),
    ("humpback_whale", "sperm_whale"),
    ("orca", "sperm_whale"),
    ("pilot_fish", "shark"),
)


def upgrade() -> None:
    for old, new in MOVES:
        op.execute(f"UPDATE partners SET funder_tier = '{new}' WHERE funder_tier = '{old}'")
    # The team's own example of a Whale Pod, if nobody has placed it yet.
    op.execute(
        "UPDATE partners SET funder_tier = 'whale_pod' "
        "WHERE funder_tier = 'unsorted' AND lower(trim(name)) = 'open athena'"
    )


def downgrade() -> None:
    # The merged tiers can't be split again; organizations go back to unsorted
    # so they aren't read as the old Whale Pods (wealthy families).
    op.execute("UPDATE partners SET funder_tier = 'unsorted' WHERE funder_tier = 'whale_pod'")
