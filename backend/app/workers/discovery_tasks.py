"""
Discovery engine Celery tasks.
These tasks are triggered by the beat scheduler or manually via the API.
"""
import asyncio
import re
import uuid
from datetime import datetime
from celery import shared_task
from app.workers.celery_app import celery_app


def _run_async(coro):
    """Helper to run async code from sync Celery tasks."""
    return asyncio.run(coro)


# Funder name substring → logo URL.
# Local static paths are served by Next.js from frontend/public/logos/.
# Google favicon URLs are used as a fallback for funders without a local file.
_FUNDER_LOGO_PATHS: dict[str, str] = {
    # US federal agencies (local files)
    "grants.gov":           "/logos/grants-gov.svg",
    "nih":                  "/logos/nih.svg",
    "nsf":                  "/logos/nsf.svg",
    "sbir":                 "/logos/nsf.svg",         # SBIR is NSF/DoD — use NSF as proxy
    "usaid":                "/logos/usaid.svg",
    # International foundations (local files)
    "bill & melinda gates": "/logos/gates-foundation.svg",
    "gates foundation":     "/logos/gates-foundation.svg",
    "wellcome":             "/logos/wellcome.svg",
    "ford foundation":      "/logos/ford-foundation.svg",
    # International foundations (Google favicon)
    "macarthur":            "https://www.google.com/s2/favicons?domain=macfound.org&sz=64",
    "chan zuckerberg":      "https://www.google.com/s2/favicons?domain=chanzuckerberg.com&sz=64",
    "open philanthropy":    "https://www.google.com/s2/favicons?domain=openphilanthropy.org&sz=64",
    "rockefeller":          "https://www.google.com/s2/favicons?domain=rockefellerfoundation.org&sz=64",
    "hewlett":              "https://www.google.com/s2/favicons?domain=hewlett.org&sz=64",
    # International organisations (local files)
    "ukri":                 "/logos/ukri.svg",
    "innovate uk":          "/logos/ukri.svg",
    "world bank":           "/logos/world-bank.svg",
    "global fund":          "/logos/global-fund.svg",
    # International organisations (Google favicon)
    "who":                  "https://www.google.com/s2/favicons?domain=who.int&sz=64",
    "world health org":     "https://www.google.com/s2/favicons?domain=who.int&sz=64",
    "unicef":               "https://www.google.com/s2/favicons?domain=unicef.org&sz=64",
    "undp":                 "https://www.google.com/s2/favicons?domain=undp.org&sz=64",
    "unops":                "https://www.google.com/s2/favicons?domain=unops.org&sz=64",
    # EU / Horizon Europe (local files)
    "horizon europe":       "/logos/horizon-europe.svg",
    "european commission":  "/logos/horizon-europe.svg",
    "erc":                  "/logos/horizon-europe.svg",
    "eic":                  "/logos/horizon-europe.svg",
    # EU / other (Google favicon)
    "snsf":                 "https://www.google.com/s2/favicons?domain=snf.ch&sz=64",
    "snf":                  "https://www.google.com/s2/favicons?domain=snf.ch&sz=64",
    "sshrc":                "https://www.google.com/s2/favicons?domain=sshrc-crsh.gc.ca&sz=64",
    "nwo":                  "https://www.google.com/s2/favicons?domain=nwo.nl&sz=64",
    # Global health (local + Google favicon)
    "edctp":                "/logos/edctp.jpg",
    "elrha":                "/logos/wellcome.svg",    # Elrha is Wellcome/FCDO-funded
    # Media / philanthropy
    "ted":                  "https://www.google.com/s2/favicons?domain=ted.com&sz=64",
    "audacious":            "https://www.google.com/s2/favicons?domain=ted.com&sz=64",
    # Other funders
    "aga khan":             "https://www.google.com/s2/favicons?domain=akdn.org&sz=64",
    "comic relief":         "https://www.google.com/s2/favicons?domain=comicrelief.com&sz=64",
    "dfid":                 "https://www.google.com/s2/favicons?domain=gov.uk&sz=64",
    "fcdo":                 "https://www.google.com/s2/favicons?domain=gov.uk&sz=64",
}


def _get_funder_logo_url(funder_name: str) -> str | None:
    """Return a local static logo path for a funder, or None if not mapped.

    Short keys (≤4 chars) use word-boundary matching to avoid false positives
    like 'nsf' matching 'SNSF' or 'ted' matching 'United'.
    """
    if not funder_name:
        return None
    name_lower = funder_name.lower()
    for key, path in _FUNDER_LOGO_PATHS.items():
        # Short acronyms (≤4 chars) need word-boundary matching to prevent
        # false positives e.g. "nsf" inside "SNSF" or "ted" inside "United"
        if len(key) <= 4:
            if re.search(r'\b' + re.escape(key) + r'\b', name_lower):
                return path
        elif key in name_lower:
            return path
    return None


_SCAN_STAGGER_SECONDS = 15  # gap between each scan_source dispatch


@celery_app.task(name="app.workers.discovery_tasks.scan_all_sources", bind=True, max_retries=2)
def scan_all_sources(self):
    """Full scan of all non-paused sources. Includes broken/under_review so every
    source gets a fresh attempt when triggered manually via Refresh Sources."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.source import Source

    settings = get_settings()
    # Use sync engine for Celery tasks
    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        sources = db.execute(
            select(Source).where(Source.status.in_(["active", "broken", "under_review"]))
        ).scalars().all()
        # Stagger dispatches to avoid simultaneous LLM call storms that
        # exhaust the OpenAI rate limit (429s). AI-scraper sources cause
        # the most load, so every task gets a countdown offset.
        for i, source in enumerate(sources):
            scan_source.apply_async(
                args=[str(source.id)],
                countdown=i * _SCAN_STAGGER_SECONDS,
            )
    return {"queued": len(sources) if sources else 0}


@celery_app.task(name="app.workers.discovery_tasks.scan_high_priority_sources")
def scan_high_priority_sources():
    """Daily scan of high-priority sources."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.source import Source

    settings = get_settings()
    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        sources = db.execute(
            select(Source).where(Source.status == "active", Source.is_high_priority == True)
        ).scalars().all()
        for i, source in enumerate(sources):
            scan_source.apply_async(
                args=[str(source.id)],
                countdown=i * _SCAN_STAGGER_SECONDS,
            )
    return {"queued": len(sources) if sources else 0}


@celery_app.task(
    name="app.workers.discovery_tasks.scan_source",
    bind=True,
    max_retries=3,
    # Hard cap at 4 per minute across all workers — each AI-scraper source
    # makes 1-2 LLM calls, so this keeps concurrent API pressure well under
    # the OpenAI gpt-4o-mini RPM limit.
    rate_limit="4/m",
)
def scan_source(self, source_id: str):
    """
    Scan a single source for new opportunities.
    1. Fetch listings from source connector
    2. Normalize to standard schema
    3. Check for duplicates
    4. Score new opportunities
    5. Add to review queue
    6. Send notifications
    """
    import structlog
    logger = structlog.get_logger()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.source import Source, SourceRun, SourceRunStatus

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        source = db.get(Source, source_id)
        if not source:
            return {"error": "Source not found"}

        run = SourceRun(
            id=str(uuid.uuid4()),
            source_id=source_id,
            started_at=datetime.utcnow(),
            status=SourceRunStatus.RUNNING,
            parser_version="1.0",
        )
        db.add(run)
        db.commit()

        try:
            # Get the appropriate scraper
            from app.scrapers import get_scraper
            scraper = get_scraper(source)
            raw_listings = scraper.fetch()

            new_count = 0
            updated_count = 0
            dup_count = 0

            for listing in raw_listings:
                result = _process_listing(db, listing, source_id, source.url)
                if result == "new":
                    new_count += 1
                elif result == "updated":
                    updated_count += 1
                elif result == "duplicate":
                    dup_count += 1

            # Update run record
            run.status = SourceRunStatus.SUCCESS
            run.ended_at = datetime.utcnow()
            run.records_found = len(raw_listings)
            run.new_opportunities = new_count
            run.updated_opportunities = updated_count
            run.duplicates = dup_count

            # Update source stats; restore broken/under_review sources on success
            source.status = "active"
            source.last_checked = datetime.utcnow()
            source.last_successful_run = datetime.utcnow()
            source.opportunities_discovered += len(raw_listings)
            source.opportunities_added += new_count
            source.duplicates_detected += dup_count

            db.commit()
            logger.info("Source scan complete", source=source.name, new=new_count, dups=dup_count)
            return {"source": source.name, "new": new_count, "updated": updated_count, "duplicates": dup_count}

        except Exception as e:
            run.status = SourceRunStatus.FAILED
            run.ended_at = datetime.utcnow()
            run.errors = [str(e)]
            source.error_log = (source.error_log or []) + [{"time": str(datetime.utcnow()), "error": str(e)}]
            db.commit()
            logger.error("Source scan failed", source=source.name, error=str(e))
            raise self.retry(exc=e, countdown=300)


def _process_listing(db, listing: dict, source_id: str, source_url: str | None = None) -> str:
    """Process a single raw listing: normalize, deduplicate, persist."""
    from app.services.opportunity_dedup import find_existing_duplicate

    call_url = (listing.get("url") or "").strip()
    if not call_url:
        return "skipped"

    # Inject source_id into listing so dedup can use it for score-30 check
    listing_with_source = {**listing, "source_id": source_id}
    existing, is_definitive = find_existing_duplicate(db, listing_with_source)

    if existing and is_definitive:
        # Re-queue enrichment only if the record was never successfully fetched
        # and hasn't been permanently marked as unfetchable.
        parsed = existing.parsed_text or ""
        if not parsed and existing.opportunity_url:
            from app.workers.enrichment_tasks import enrich_opportunity
            enrich_opportunity.delay(str(existing.id))
        return "duplicate"

    from app.models.opportunity import Opportunity, DuplicateStatus

    # Resolve funder logo URL
    funder_logo_url = _get_funder_logo_url(listing.get("funder") or "")

    dup_status = DuplicateStatus.POSSIBLE_DUPLICATE if (existing and not is_definitive) else DuplicateStatus.UNIQUE

    opp = Opportunity(
        id=str(uuid.uuid4()),
        title=listing.get("title", "Untitled"),
        funder=listing.get("funder"),
        program_name=listing.get("program_name") or listing.get("program"),
        opportunity_number=listing.get("opportunity_number"),
        description=listing.get("description"),
        opportunity_url=call_url,
        source_url=source_url,
        source_id=source_id,
        # "active" signals the global record is live. Workflow status
        # (new/needs_review/archived/etc.) lives in institution_opportunities.
        status="active",
        duplicate_status=dup_status,
        raw_text=listing.get("raw_text"),
        funder_logo_url=funder_logo_url,
    )

    # Parse deadline if present
    if listing.get("deadline"):
        try:
            from datetime import date
            import dateutil.parser
            opp.deadline = dateutil.parser.parse(listing["deadline"]).date()
        except Exception:
            pass

    db.add(opp)
    db.commit()

    # Surface to all institutions synchronously so queue works even without a Celery worker.
    from app.services.grant_bootstrap import surface_opportunity_for_all_institutions
    surface_opportunity_for_all_institutions(db, opp)

    # Queue full-page description enrichment
    from app.workers.enrichment_tasks import enrich_opportunity
    enrich_opportunity.delay(str(opp.id))
    return "new"


@celery_app.task(name="app.workers.discovery_tasks.deduplicate_opportunity_pool", bind=True, max_retries=1)
def deduplicate_opportunity_pool(self):
    """Scan the active opportunity pool and mark lower-quality duplicates.

    Groups all active Opportunity rows by dedup_key() (the same logic used at
    ingest). Within each duplicate group the most-enriched record is kept
    (ranked by: has parsed_text > has description > fit_score > date_discovered).
    All other members of the group have their status set to "duplicate".

    Safe to re-run: already-marked rows are excluded from the scan.
    """
    import structlog
    from collections import defaultdict
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity
    from app.services.opportunity_dedup import dedup_key

    log = structlog.get_logger()
    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        opps = db.execute(
            select(Opportunity).where(Opportunity.status != "duplicate")
        ).scalars().all()

        # Group by dedup key
        groups: dict[str, list[Opportunity]] = defaultdict(list)
        no_key: list[Opportunity] = []
        for opp in opps:
            k = dedup_key(opp)
            if k:
                groups[k].append(opp)
            else:
                no_key.append(opp)

        def _quality(o: Opportunity) -> tuple:
            """Higher tuple = better record to keep."""
            return (
                1 if o.parsed_text else 0,
                1 if (o.description or o.short_summary) else 0,
                o.fit_score or 0,
                o.date_discovered.timestamp() if o.date_discovered else 0,
            )

        marked = 0
        for key, group in groups.items():
            if len(group) <= 1:
                continue
            # Sort descending — best record first
            group.sort(key=_quality, reverse=True)
            keeper = group[0]
            for dup in group[1:]:
                dup.status = "duplicate"
                marked += 1
                log.info(
                    "opportunity.marked_duplicate",
                    kept_id=keeper.id,
                    dup_id=dup.id,
                    key=key,
                )

        if marked:
            db.commit()

        log.info(
            "deduplicate_opportunity_pool complete",
            total_scanned=len(opps),
            groups=len(groups),
            marked_duplicate=marked,
            no_key=len(no_key),
        )
        return {"scanned": len(opps), "marked_duplicate": marked}


@celery_app.task(name="app.workers.discovery_tasks.score_opportunity")
def score_opportunity(opportunity_id: str):
    """Score a newly enriched opportunity.

    Uses the LLM fit_scorer when fit_scoring.background_llm=true in config.yaml,
    otherwise falls back to zero-cost keyword scoring.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity
    from app.services.keyword_scorer import keyword_score_opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return

        use_llm = settings.fit_scoring.background_llm

        if use_llm:
            try:
                from app.ai.agents.fit_scorer import score_opportunity as llm_score
                result = asyncio.run(llm_score(
                    title=opp.title,
                    description=opp.description or opp.parsed_text or "",
                    funder=opp.funder or "",
                    eligibility=opp.eligibility_criteria or "",
                    geography=", ".join(opp.geography or []),
                    award_amount=f"{opp.award_min}–{opp.award_max}" if opp.award_min else "",
                    deadline=str(opp.deadline) if opp.deadline else "",
                ))
                opp.fit_score = result.get("fit_score", 0)
                opp.priority = result.get("priority", "low_fit")
                opp.fit_rationale = result.get("rationale", "")
            except Exception:
                use_llm = False  # fall through to keyword scoring on LLM failure

        if not use_llm:
            result = keyword_score_opportunity(
                title=opp.title,
                description=opp.description or opp.parsed_text or "",
                funder=opp.funder or "",
                eligibility=opp.eligibility_criteria or "",
                geography=opp.geography or [],
                award_min=opp.award_min,
                award_max=opp.award_max,
                deadline=opp.deadline,
                thematic_areas=opp.thematic_areas or [],
            )
            opp.fit_score = result["fit_score"]
            opp.priority = result["priority"]
            if result.get("matched_themes"):
                opp.thematic_areas = list(set(opp.thematic_areas or []) | set(result["matched_themes"]))

        db.commit()


@celery_app.task(name="app.workers.discovery_tasks.check_source_health")
def check_source_health():
    """Check which sources haven't run recently and flag them."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from datetime import timedelta
    from app.config import get_settings
    from app.models.source import Source

    settings = get_settings()
    engine = create_engine(settings.database_url)
    cutoff = datetime.utcnow() - timedelta(days=10)

    with Session(engine) as db:
        # Only flag sources that have been scanned before but haven't been
        # checked recently. Sources with last_checked=NULL have never run
        # and should not be penalised — they're awaiting their first scan.
        stale = db.execute(
            select(Source).where(
                Source.status == "active",
                Source.last_checked != None,
                Source.last_checked < cutoff
            )
        ).scalars().all()

        for source in stale:
            source.status = "under_review"
        db.commit()

    return {"stale_sources": len(stale)}
