"""Funders: partners sorted into whale tiers, for organizations with the
"funders" feature switched on (LiGHT).

A funder is a Partner with `funder_tier` set, so a funder keeps the partner's
contact log, tasks, meetings and follow-ups and stays in the Partners list.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.institution import Institution
from app.models.partner import Partner
from app.models.partner_organization import PartnerOrganization
from app.models.partner_task import PartnerTask

FEATURE = "funders"
SEEDED_FLAG = "funders_seeded"

# Ordered from the largest pools of capital down to the people around them.
# "unsorted" holds funders added before anyone has picked a tier.
FUNDER_TIERS: tuple[str, ...] = (
    "blue_whale",
    "whale_pod",
    "whale_calf",
    "matriarch",
    "sperm_whale",
    "humpback_whale",
    "orca",
    "dolphin",
    "pilot_fish",
    "shark",
    "unsorted",
)


def valid_tier(tier: str | None) -> bool:
    return tier in FUNDER_TIERS


def tier_rank(tier: str | None) -> int:
    return FUNDER_TIERS.index(tier) if tier in FUNDER_TIERS else len(FUNDER_TIERS)


def has_feature(inst: Institution | None, key: str = FEATURE) -> bool:
    return bool(inst and isinstance(inst.features, dict) and inst.features.get(key) is True)


def enabled_features(inst: Institution | None) -> list[str]:
    """Feature switches that are on, for the /auth/me payload."""
    if not inst or not isinstance(inst.features, dict):
        return []
    return sorted(k for k, v in inst.features.items() if v is True and k != SEEDED_FLAG)


# ── Starter list ───────────────────────────────────────────────────────────────
# From the team's Slack thread (Nov 2026). Tiers are only set where the thread
# named one; everyone else starts in "unsorted" for the team to place.

@dataclass(frozen=True)
class StarterFunder:
    name: str
    tier: str
    organization: str | None = None
    title: str | None = None
    linkedin_url: str | None = None
    website: str | None = None
    city: str | None = None
    country: str | None = None
    notes: str | None = None
    tasks: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class StarterOrg:
    name: str
    org_type: str = "foundation"
    website: str | None = None
    city: str | None = None
    country: str | None = None
    description: str | None = None


STARTER_ORGS: tuple[StarterOrg, ...] = (
    StarterOrg(
        "SwissFoundations",
        org_type="network",
        website="https://www.linkedin.com/company/swissfoundations/",
        country="Switzerland",
        description="Association of Swiss grant-making foundations, founded in 2001 by eleven foundations.",
    ),
    StarterOrg("Fondation Leenaards", city="Geneva", country="Switzerland"),
    StarterOrg("Jakob und Emma Windler-Stiftung", city="Zurich", country="Switzerland"),
    StarterOrg(
        "Vontobel Foundation",
        website="https://www.vontobel-stiftung.ch/en-ch/",
        country="Switzerland",
        description="Sponsor of social, scientific and dialogue-strengthening projects.",
    ),
    StarterOrg("Open Athena", org_type="other"),
)

STARTER_FUNDERS: tuple[StarterFunder, ...] = (
    StarterFunder(
        "Karin Jestin", "dolphin",
        organization="SwissFoundations",
        linkedin_url="https://www.linkedin.com/in/karin-jestin-26b09b1/",
        city="Geneva", country="Switzerland",
        notes="Flagged as a Dolphin in Slack. Map the organizations she is tied to, starting with SwissFoundations.",
    ),
    StarterFunder(
        "Sabrina Grassi", "unsorted",
        organization="Fondation Leenaards",
        linkedin_url="https://www.linkedin.com/in/sabrinagrassi/",
        city="Geneva", country="Switzerland",
        notes="Shared in the Dolphins thread. Executive with experience in the philanthropic and private sectors. Tier not set yet.",
    ),
    StarterFunder(
        "Janine Händel", "unsorted",
        organization="Jakob und Emma Windler-Stiftung",
        linkedin_url="https://www.linkedin.com/in/janine-h%C3%A4ndel/",
        city="Zurich", country="Switzerland",
        notes="Enya: no connections yet, but we should get in there. Tier not set yet.",
        tasks=("Find a warm introduction to Janine Händel",),
    ),
    StarterFunder(
        "Chuck Slaughter", "shark",
        notes="Tagged a Shark in Slack (Annie).",
    ),
    StarterFunder(
        "Open Athena", "unsorted",
        organization="Open Athena",
        notes="Enya added this for the list. An organization, not a person yet: find the right contact and rename this record.",
        tasks=("Identify a contact at Open Athena",),
    ),
    StarterFunder(
        "Vontobel Foundation CEO", "unsorted",
        organization="Vontobel Foundation", title="CEO",
        website="https://www.vontobel-stiftung.ch/en-ch/",
        country="Switzerland",
        notes="Marcel Tanner recommended contacting the CEO of the Vontobel Foundation (via Enya). Rename this record once the CEO is identified.",
        tasks=("Contact the Vontobel Foundation CEO (Marcel Tanner's recommendation)",),
    ),
)


def _norm(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def match_key(name: str | None, linkedin_url: str | None) -> tuple[str, str]:
    """How a starter entry finds a partner the team already added: by LinkedIn
    profile path, else by name."""
    url = (linkedin_url or "").lower().split("?")[0].rstrip("/")
    return url.split("linkedin.com", 1)[-1] if "linkedin.com" in url else "", _norm(name)


async def seed_starter_funders(db: AsyncSession, institution_id: str, user_id: str | None) -> int:
    """Add the starter funders to an organization. A partner who already exists
    (same LinkedIn profile or name) is tagged with the tier instead of
    duplicated; a tier someone already set is kept. Returns how many partners
    were created or tagged. Caller commits."""
    existing = (await db.execute(select(Partner).where(Partner.institution_id == institution_id))).scalars().all()
    by_url: dict[str, Partner] = {}
    by_name: dict[str, Partner] = {}
    for p in existing:
        url_key, name_key = match_key(p.name, p.linkedin_url)
        if url_key:
            by_url.setdefault(url_key, p)
        by_name.setdefault(name_key, p)

    orgs = {
        _norm(o.name): o for o in (await db.execute(
            select(PartnerOrganization).where(PartnerOrganization.institution_id == institution_id)
        )).scalars().all()
    }
    for so in STARTER_ORGS:
        if _norm(so.name) in orgs:
            continue
        org = PartnerOrganization(
            id=str(uuid.uuid4()), institution_id=institution_id, name=so.name, org_type=so.org_type,
            website=so.website, city=so.city, country=so.country, description=so.description,
            tags=["funder"], created_by=user_id,
        )
        db.add(org)
        orgs[_norm(so.name)] = org

    touched = 0
    for sf in STARTER_FUNDERS:
        url_key, name_key = match_key(sf.name, sf.linkedin_url)
        partner = (by_url.get(url_key) if url_key else None) or by_name.get(name_key)
        if partner:
            if not partner.funder_tier:
                partner.funder_tier = sf.tier
                touched += 1
            continue
        org = orgs.get(_norm(sf.organization)) if sf.organization else None
        partner = Partner(
            id=str(uuid.uuid4()), institution_id=institution_id, created_by=user_id,
            name=sf.name, title=sf.title, organization=sf.organization,
            organization_id=org.id if org else None,
            linkedin_url=sf.linkedin_url, website=sf.website, city=sf.city, country=sf.country,
            notes=sf.notes, funder_tier=sf.tier, tags=[], project_types=[],
            status="prospect", relationship_stage="prospect",
        )
        db.add(partner)
        for title in sf.tasks:
            db.add(PartnerTask(
                id=str(uuid.uuid4()), partner_id=partner.id, institution_id=institution_id,
                title=title, created_by=user_id,
            ))
        touched += 1
    return touched


def needs_seed(inst: Institution | None) -> bool:
    return has_feature(inst) and not (inst.features or {}).get(SEEDED_FLAG)


async def ensure_seeded(db: AsyncSession, inst: Institution, user_id: str | None) -> None:
    """The first time an organization opens Funders, load the starter list.
    The institution row is locked so two first visits can't both seed."""
    if not needs_seed(inst):
        return
    locked = (await db.execute(
        select(Institution).where(Institution.id == inst.id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one()
    if needs_seed(locked):
        await seed_starter_funders(db, locked.id, user_id)
        locked.features = {**(locked.features or {}), SEEDED_FLAG: True}
    # Commit (not rollback) to release the lock: the session doesn't expire on
    # commit, so objects already loaded in this request stay usable.
    await db.commit()


async def funder_count(db: AsyncSession, institution_id: str) -> int:
    return (await db.execute(
        select(func.count(Partner.id)).where(Partner.institution_id == institution_id, Partner.funder_tier.isnot(None))
    )).scalar() or 0
