"""
Discovery engine Celery tasks.
These tasks are triggered by the beat scheduler or manually via the API.
"""
import asyncio
import uuid
from datetime import datetime
from celery import shared_task
from app.workers.celery_app import celery_app


def _run_async(coro):
    """Helper to run async code from sync Celery tasks."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(name="app.workers.discovery_tasks.scan_all_sources", bind=True, max_retries=2)
def scan_all_sources(self):
    """Weekly full scan of all active sources."""
    from sqlalchemy import select, create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.source import Source

    settings = get_settings()
    # Use sync engine for Celery tasks
    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        sources = db.execute(select(Source).where(Source.status == "active")).scalars().all()
        for source in sources:
            scan_source.delay(str(source.id))
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
        for source in sources:
            scan_source.delay(str(source.id))
    return {"queued": len(sources) if sources else 0}


@celery_app.task(name="app.workers.discovery_tasks.scan_source", bind=True, max_retries=3)
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
                result = _process_listing(db, listing, source_id)
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

            # Update source stats
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


def _process_listing(db, listing: dict, source_id: str) -> str:
    """Process a single raw listing: normalize, deduplicate, persist."""
    from sqlalchemy import select
    from app.models.opportunity import Opportunity, DuplicateStatus

    # Check for URL duplicate
    if listing.get("url"):
        existing = db.execute(
            select(Opportunity).where(Opportunity.opportunity_url == listing["url"])
        ).scalar_one_or_none()
        if existing:
            return "duplicate"

    opp = Opportunity(
        id=str(uuid.uuid4()),
        title=listing.get("title", "Untitled"),
        funder=listing.get("funder"),
        program_name=listing.get("program"),
        description=listing.get("description"),
        opportunity_url=listing.get("url"),
        source_id=source_id,
        status="new",
        duplicate_status=DuplicateStatus.UNIQUE,
        raw_text=listing.get("raw_text"),
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

    # Queue AI scoring
    score_opportunity.delay(str(opp.id))
    return "new"


@celery_app.task(name="app.workers.discovery_tasks.score_opportunity")
def score_opportunity(opportunity_id: str):
    """Score an opportunity using Qwen fit scorer."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    async def _score():
        from app.ai.agents.fit_scorer import score_opportunity as qwen_score
        with Session(engine) as db:
            opp = db.get(Opportunity, opportunity_id)
            if not opp:
                return
            result = await qwen_score(
                title=opp.title,
                description=opp.description or "",
                funder=opp.funder or "",
                eligibility=opp.eligibility_criteria or "",
                geography=str(opp.geography),
                award_amount=f"{opp.award_min}-{opp.award_max} {opp.currency or ''}",
                deadline=str(opp.deadline) if opp.deadline else "",
            )
            opp.fit_score = result.get("fit_score", 0)
            opp.priority = result.get("priority", "watchlist")
            opp.fit_rationale = result.get("rationale", "")
            if result.get("matched_themes"):
                opp.thematic_areas = list(set(opp.thematic_areas or []) | set(result["matched_themes"]))
            if opp.fit_score and opp.fit_score >= settings.discovery.get("auto_queue_threshold", 40):
                opp.status = "needs_review"
            db.commit()

    _run_async(_score())


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
        stale = db.execute(
            select(Source).where(
                Source.status == "active",
                (Source.last_checked == None) | (Source.last_checked < cutoff)
            )
        ).scalars().all()

        for source in stale:
            source.status = "under_review"
        db.commit()

    return {"stale_sources": len(stale)}
