"""Bootstrap global grant pool from JSON and fan out to institutions."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, select, and_, func, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.institution import Institution
from app.models.institution_opportunity import InstitutionOpportunity
from app.models.institution_source import InstitutionSource
from app.models.opportunity import Opportunity
from app.models.source import Source
from app.schemas.grant_profile import GrantProfile, opportunity_matches_keywords

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _parse_date(val: str | None) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(val[:10])
    except ValueError:
        return None


def seed_sources_from_json(session: Session, json_path: Path | None = None) -> int:
    path = json_path or DATA_DIR / "grant_funding_portals.json"
    if not path.exists():
        logger.warning("Sources JSON not found: %s", path)
        return 0
    payload = json.loads(path.read_text())
    existing = {row[0].lower() for row in session.execute(text("SELECT name FROM sources")).fetchall()}
    added = 0
    for row in payload.get("sources", []):
        name = row["name"]
        if name.lower() in existing:
            continue
        source = Source(id=str(uuid.uuid4()), **row)
        session.add(source)
        existing.add(name.lower())
        added += 1
    session.commit()
    logger.info("Seeded %d sources from JSON", added)
    return added


def seed_opportunities_from_json(session: Session, json_path: Path | None = None) -> int:
    path = json_path or DATA_DIR / "grant_opportunities_seed.json"
    if not path.exists():
        logger.warning("Opportunities JSON not found: %s", path)
        return 0
    payload = json.loads(path.read_text())
    added = 0
    for row in payload.get("opportunities", []):
        seed_key = row.get("seed_key") or row["title"].lower().strip()
        existing = session.execute(
            text("SELECT id FROM opportunities WHERE lower(title) = :k"),
            {"k": seed_key},
        ).fetchone()
        if existing:
            continue
        opp = Opportunity(
            id=str(uuid.uuid4()),
            title=row["title"],
            funder=row.get("funder"),
            program_name=row.get("program_name"),
            fit_score=row.get("fit_score"),
            priority=row.get("priority"),
            fit_rationale=row.get("fit_rationale"),
            deadline=_parse_date(row.get("deadline")),
            award_min=row.get("award_min"),
            award_max=row.get("award_max"),
            currency=row.get("currency"),
            opportunity_url=row.get("opportunity_url"),
            notes=row.get("notes"),
            status=row.get("status") or "new",
            thematic_areas=row.get("thematic_areas") or [],
            keywords=row.get("keywords") or [],
            geography=row.get("geography") or [],
        )
        session.add(opp)
        added += 1
    session.commit()
    logger.info("Seeded %d opportunities from JSON", added)
    return added


def fan_out_sources_to_institutions(session: Session) -> int:
    """Ensure every institution has InstitutionSource rows for all global sources."""
    institutions = session.execute(select(Institution)).scalars().all()
    sources = session.execute(select(Source)).scalars().all()
    if not institutions or not sources:
        return 0
    linked = 0
    for inst in institutions:
        existing_ids = {
            row[0]
            for row in session.execute(
                select(InstitutionSource.source_id).where(
                    InstitutionSource.institution_id == inst.id
                )
            ).all()
        }
        for source in sources:
            if source.id in existing_ids:
                continue
            session.add(
                InstitutionSource(
                    institution_id=inst.id,
                    source_id=source.id,
                    is_enabled=True,
                )
            )
            linked += 1
    session.commit()
    logger.info("Linked %d institution-source rows", linked)
    return linked


def _enabled_source_ids(session: Session, institution_id: str) -> set[str] | None:
    rows = session.execute(
        select(InstitutionSource.source_id, InstitutionSource.is_enabled).where(
            InstitutionSource.institution_id == institution_id
        )
    ).all()
    if not rows:
        return None
    enabled = {sid for sid, is_on in rows if is_on}
    disabled_any = any(not is_on for _, is_on in rows)
    if not disabled_any and len(enabled) == len(rows):
        return None  # all enabled — no filter
    return enabled


def surface_opportunity_for_institution(
    session: Session,
    institution_id: str,
    opportunity: Opportunity,
    *,
    force: bool = False,
) -> InstitutionOpportunity | None:
    enabled = _enabled_source_ids(session, institution_id)
    if enabled is not None and opportunity.source_id and opportunity.source_id not in enabled:
        return None

    inst = session.get(Institution, institution_id)
    if not inst:
        return None

    existing = session.get(
        InstitutionOpportunity,
        {"institution_id": institution_id, "opportunity_id": opportunity.id},
    )
    if existing and not force:
        return existing

    profile = GrantProfile.from_dict(inst.grant_profile or {})
    threshold = profile.auto_queue_threshold

    fit_score = opportunity.fit_score
    priority = opportunity.priority
    rationale = opportunity.fit_rationale
    status = "needs_review"

    if profile.keywords or profile.excluded_keywords:
        if not opportunity_matches_keywords(opportunity, profile.keywords, profile.excluded_keywords):
            status = "archived"
            fit_score = fit_score or 0
        elif fit_score is None:
            fit_score = 50.0
            priority = "watchlist"
    elif fit_score is None:
        fit_score = 50.0
        priority = "watchlist"

    if fit_score is not None and fit_score < threshold and status != "archived":
        status = "new"

    if existing:
        existing.fit_score = fit_score
        existing.priority = priority
        existing.fit_rationale = rationale
        existing.status = status
        existing.scored_at = datetime.now(timezone.utc)
        row = existing
    else:
        row = InstitutionOpportunity(
            institution_id=institution_id,
            opportunity_id=opportunity.id,
            fit_score=fit_score,
            priority=priority,
            fit_rationale=rationale,
            status=status,
            scored_at=datetime.now(timezone.utc),
        )
        session.add(row)
    return row


def surface_opportunity_for_all_institutions(session: Session, opportunity: Opportunity) -> int:
    """Link one opportunity to every institution (creates InstitutionOpportunity rows)."""
    institutions = session.execute(select(Institution)).scalars().all()
    count = 0
    for inst in institutions:
        if surface_opportunity_for_institution(session, inst.id, opportunity):
            count += 1
    if count:
        session.commit()
    return count


def surface_missing_institution_links(session: Session, institution_id: str) -> int:
    """Create InstitutionOpportunity rows for global opps not yet linked to an institution."""
    missing = session.execute(
        select(Opportunity)
        .outerjoin(
            InstitutionOpportunity,
            and_(
                InstitutionOpportunity.opportunity_id == Opportunity.id,
                InstitutionOpportunity.institution_id == institution_id,
            ),
        )
        .where(Opportunity.status != "duplicate")
        .where(InstitutionOpportunity.opportunity_id.is_(None))
    ).scalars().all()

    count = 0
    for opp in missing:
        if surface_opportunity_for_institution(session, institution_id, opp):
            count += 1
    if count:
        session.commit()
    return count


def surface_missing_for_all_institutions(session: Session) -> int:
    institutions = session.execute(select(Institution)).scalars().all()
    total = 0
    for inst in institutions:
        total += surface_missing_institution_links(session, inst.id)
    return total


def bootstrap_institution_feed(session: Session, institution_id: str, *, force: bool = False) -> int:
    """Surface all global opportunities for one institution.

    When force=True every existing InstitutionOpportunity record is re-evaluated
    and its status/score updated from the current institution profile and
    opportunity data.  Use force=True to recover from archived/missing records.
    """
    opps = session.execute(select(Opportunity)).scalars().all()
    count = 0
    for opp in opps:
        if surface_opportunity_for_institution(session, institution_id, opp, force=force):
            count += 1
    session.commit()
    return count


def bootstrap_all_institution_feeds(session: Session, *, force: bool = False) -> int:
    institutions = session.execute(select(Institution)).scalars().all()
    total = 0
    for inst in institutions:
        total += bootstrap_institution_feed(session, inst.id, force=force)
    return total


def needs_resync(session: Session, institution_id: str) -> bool:
    """Return True if any non-duplicate opportunity lacks an InstitutionOpportunity row."""
    missing = session.execute(
        select(func.count())
        .select_from(Opportunity)
        .outerjoin(
            InstitutionOpportunity,
            and_(
                InstitutionOpportunity.opportunity_id == Opportunity.id,
                InstitutionOpportunity.institution_id == institution_id,
            ),
        )
        .where(Opportunity.status != "duplicate")
        .where(InstitutionOpportunity.opportunity_id.is_(None))
    ).scalar()
    return (missing or 0) > 0


def queue_missing_enrichments(session: Session) -> int:
    """Queue detail-page fetches for opportunities that only have listing snippets."""
    from app.workers.enrichment_tasks import enrich_opportunity

    opps = session.execute(
        select(Opportunity).where(
            Opportunity.opportunity_url.isnot(None),
            (Opportunity.parsed_text.is_(None)) | (Opportunity.parsed_text == ""),
        )
    ).scalars().all()
    for opp in opps:
        enrich_opportunity.delay(str(opp.id))
    logger.info("Queued enrichment for %d opportunities missing descriptions", len(opps))
    return len(opps)


def run_full_bootstrap(*, force: bool = False) -> dict:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    with Session(engine) as session:
        sources_added = seed_sources_from_json(session)
        opps_added = seed_opportunities_from_json(session)
        sources_linked = fan_out_sources_to_institutions(session)

        # Force a resync if any institution has opportunities in the global pool
        # but no InstitutionOpportunity rows (i.e. first boot or after data loss).
        institutions = session.execute(select(Institution)).scalars().all()
        should_force = force or any(needs_resync(session, i.id) for i in institutions)
        if force:
            feeds = bootstrap_all_institution_feeds(session, force=True)
        else:
            feeds = surface_missing_for_all_institutions(session)
            if should_force:
                logger.info(
                    "Surfaced missing institution_opportunity links for %d institutions",
                    len(institutions),
                )
        enrichments_queued = queue_missing_enrichments(session)
    return {
        "sources_added": sources_added,
        "opportunities_added": opps_added,
        "institution_sources_linked": sources_linked,
        "institution_opportunities_created": feeds,
        "enrichments_queued": enrichments_queued,
        "force_resync": should_force,
    }
