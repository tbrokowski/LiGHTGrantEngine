"""Research a CRM partner on the web and write what was found onto their record.

Shared by bulk add-from-emails (one Celery task per contact) and the
per-partner "Enrich now" button. Research never overwrites what the team typed:
it fills empty fields, merges tags, and replaces the name only when the name
on file was guessed from an email address.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_sync import get_sync_engine
from app.models.partner import Partner

logger = structlog.get_logger()

_FILL_FIELDS = ("title", "organization", "department", "city", "country",
                "linkedin_url", "website", "orcid", "google_scholar_id")
_FIELD_LIMITS = {"title": 200, "organization": 300, "department": 200, "city": 100,
                 "country": 100, "linkedin_url": 1000, "website": 1000,
                 "orcid": 100, "google_scholar_id": 200}


def _link_organization(db: Session, partner: Partner) -> None:
    """Attach the partner to an existing CRM organization whose domain matches
    their email. Never creates organizations — that stays a deliberate act."""
    if partner.organization_id or not partner.email or not partner.institution_id:
        return
    from app.models.partner_organization import PartnerOrganization

    domain = partner.email.partition("@")[2].lower()
    if not domain:
        return
    orgs = db.execute(
        select(PartnerOrganization).where(
            PartnerOrganization.institution_id == partner.institution_id,
            PartnerOrganization.domain.isnot(None),
        )
    ).scalars().all()
    for org in orgs:
        d = (org.domain or "").lower().removeprefix("www.").strip()
        if d and (domain == d or domain.endswith("." + d)):
            partner.organization_id = org.id
            partner.organization = partner.organization or org.name
            return


def apply_profile(db: Session, partner: Partner, profile: dict, *, name_guessed: bool) -> None:
    for field in _FILL_FIELDS:
        value = (profile.get(field) or "").strip() if isinstance(profile.get(field), str) else ""
        if value and not getattr(partner, field):
            setattr(partner, field, value[:_FIELD_LIMITS[field]])

    full_name = (profile.get("full_name") or "").strip()
    if name_guessed and full_name:
        partner.name = full_name[:300]

    if (bio := (profile.get("bio") or "").strip()):
        partner.bio = bio
    if profile.get("sources"):
        partner.enrichment_sources = profile["sources"]
    if profile.get("h_index") is not None:
        partner.h_index = profile["h_index"]

    tags = list(partner.tags or [])
    lower = {t.lower() for t in tags}
    if partner.organization and not any(t.startswith("from:") for t in tags):
        tags.insert(0, f"from:{partner.organization}")
    for t in profile.get("expertise_tags") or []:
        if t.lower() not in lower:
            tags.append(t)
            lower.add(t.lower())
    partner.tags = tags

    _link_organization(db, partner)
    partner.enrichment_source = profile.get("enrichment_source") or "web"


async def research_partner(partner_id: str, name_guessed: bool = False) -> str:
    """Research one partner and save the result. Returns the final status."""
    from app.ai.agents.partner_profile_researcher import research_contact

    engine = get_sync_engine()
    with Session(engine) as db:
        partner = db.get(Partner, partner_id)
        if not partner:
            return "missing"
        partner.enrichment_status = "pending"
        db.commit()
        args = dict(email=partner.email, name=partner.name, organization=partner.organization,
                    title=partner.title, orcid=partner.orcid, name_guessed=name_guessed,
                    tags=list(partner.tags or []))

    status = "failed"
    try:
        profile = await research_contact(**args)
        status = "done" if profile.get("sources") or profile.get("bio") else "not_found"
    except Exception as exc:
        logger.warning("partner research failed", partner_id=partner_id, error=str(exc))
        profile = {}

    with Session(engine) as db:
        partner = db.get(Partner, partner_id)
        if not partner:
            return "missing"
        if profile:
            apply_profile(db, partner, profile, name_guessed=name_guessed)
        partner.enrichment_status = status
        partner.last_enriched_at = datetime.now(timezone.utc)
        db.commit()
    return status


# Per-contact cap inside a batch so one slow site can't hold up the rest.
CONTACT_TIMEOUT_S = 150
BATCH_CONCURRENCY = 4


async def research_many(items: list[tuple[str, bool]], concurrency: int = BATCH_CONCURRENCY) -> dict[str, str]:
    sem = asyncio.Semaphore(concurrency)

    async def one(pid: str, guessed: bool) -> tuple[str, str]:
        async with sem:
            try:
                return pid, await asyncio.wait_for(research_partner(pid, guessed), CONTACT_TIMEOUT_S)
            except Exception as exc:  # includes TimeoutError
                logger.warning("partner research failed", partner_id=pid, error=repr(exc))
                await asyncio.to_thread(mark_research_failed, pid)
                return pid, "failed"

    return dict(await asyncio.gather(*(one(pid, g) for pid, g in items)))


def run_batch_sync(items: list[tuple[str, bool]]) -> dict[str, str]:
    """Entry point for the Celery batch task."""
    return asyncio.run(research_many(items))


def fail_stale(hours: int = 2) -> int:
    from datetime import timedelta
    from sqlalchemy import update
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    with Session(get_sync_engine()) as db:
        res = db.execute(
            update(Partner)
            .where(Partner.enrichment_status == "pending", Partner.updated_at < cutoff)
            .values(enrichment_status="failed")
        )
        db.commit()
        return res.rowcount or 0


def run_research_sync(partner_id: str, name_guessed: bool = False) -> str:
    """Entry point for Celery / threads, which have no running event loop."""
    return asyncio.run(research_partner(partner_id, name_guessed))


def mark_research_failed(partner_id: str) -> None:
    with Session(get_sync_engine()) as db:
        partner = db.get(Partner, partner_id)
        if partner and partner.enrichment_status == "pending":
            partner.enrichment_status = "failed"
            db.commit()
