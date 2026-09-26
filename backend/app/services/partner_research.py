"""Research a CRM partner on the web and write what was found onto their record.

Shared by bulk add-from-emails and the per-partner "Research online" button;
runs inside the API process (see start_research at the bottom). Research never overwrites what the team typed:
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
    for t in profile.get("expertise_tags") or []:
        if t.lower() not in lower:
            tags.append(t)
            lower.add(t.lower())
    partner.tags = tags

    _link_organization(db, partner)
    partner.enrichment_source = profile.get("enrichment_source") or "web"


def _load_for_research(partner_id: str, name_guessed: bool) -> dict | None:
    with Session(get_sync_engine()) as db:
        partner = db.get(Partner, partner_id)
        if not partner:
            return None
        partner.enrichment_status = "pending"
        db.commit()
        return dict(email=partner.email, name=partner.name, organization=partner.organization,
                    title=partner.title, orcid=partner.orcid, name_guessed=name_guessed,
                    tags=list(partner.tags or []))


def _save_research(partner_id: str, profile: dict, status: str, name_guessed: bool) -> str:
    with Session(get_sync_engine()) as db:
        partner = db.get(Partner, partner_id)
        if not partner:
            return "missing"
        if profile:
            apply_profile(db, partner, profile, name_guessed=name_guessed)
        partner.enrichment_status = status
        partner.last_enriched_at = datetime.now(timezone.utc)
        db.commit()
    return status


async def research_partner(partner_id: str, name_guessed: bool = False) -> str:
    """Research one partner and save the result. Returns the final status.
    Database work runs on a thread so this is safe inside the API's event loop."""
    from app.ai.agents.partner_profile_researcher import research_contact

    args = await asyncio.to_thread(_load_for_research, partner_id, name_guessed)
    if args is None:
        return "missing"

    status = "failed"
    try:
        profile = await research_contact(**args)
        status = "done" if profile.get("sources") or profile.get("bio") else "not_found"
    except Exception as exc:
        logger.warning("partner research failed", partner_id=partner_id, error=str(exc))
        profile = {}
    return await asyncio.to_thread(_save_research, partner_id, profile, status, name_guessed)


# Per-contact cap so one slow site can't hold up the rest.
CONTACT_TIMEOUT_S = 150
BATCH_CONCURRENCY = 4


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


def mark_research_failed(partner_id: str) -> None:
    with Session(get_sync_engine()) as db:
        partner = db.get(Partner, partner_id)
        if partner and partner.enrichment_status == "pending":
            partner.enrichment_status = "failed"
            db.commit()


# ── In-process runner (the API) ────────────────────────────────────────────────
# Research runs inside the API rather than on Celery: it's user-initiated and
# almost all waiting on the network, and the production worker runs one job at
# a time behind the discovery backlog, so queued research could sit for hours.

_running: set[asyncio.Task] = set()
_in_flight: set[str] = set()
_sem: asyncio.Semaphore | None = None


def start_research(items: list[tuple[str, bool]]) -> int:
    """Research these partners in the background of the current event loop,
    BATCH_CONCURRENCY at a time. Partners already being researched are
    skipped. Returns how many were started."""
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(BATCH_CONCURRENCY)
    loop = asyncio.get_running_loop()
    started = 0
    for pid, guessed in items:
        if pid in _in_flight:
            continue
        _in_flight.add(pid)
        task = loop.create_task(_run_one(pid, guessed))
        _running.add(task)
        task.add_done_callback(_running.discard)
        started += 1
    return started


async def _run_one(pid: str, guessed: bool) -> None:
    try:
        async with _sem:
            try:
                status = await asyncio.wait_for(research_partner(pid, guessed), CONTACT_TIMEOUT_S)
                logger.info("partner research finished", partner_id=pid, status=status)
            except Exception as exc:  # includes TimeoutError
                logger.warning("partner research failed", partner_id=pid, error=repr(exc))
                await asyncio.to_thread(mark_research_failed, pid)
    finally:
        _in_flight.discard(pid)


def _pending_ids() -> list[str]:
    from sqlalchemy import select
    with Session(get_sync_engine()) as db:
        return list(db.execute(select(Partner.id).where(Partner.enrichment_status == "pending")).scalars().all())


async def resume_pending_research() -> int:
    """On API startup, pick back up anything left "pending" — research that
    was queued to Celery before this change, or cut off by a redeploy."""
    ids = await asyncio.to_thread(_pending_ids)
    return start_research([(pid, False) for pid in ids]) if ids else 0
