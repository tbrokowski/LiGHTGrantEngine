"""
Enrichment tasks — fetch full grant detail pages and populate description fields.

After initial discovery inserts a thin record (title + URL + snippet), this task
fetches the full opportunity page and populates:
  - description   : main extracted grant description prose
  - parsed_text   : full cleaned page text
  - short_summary : first 2–3 sentences for quick scanning

After enrichment completes, score_opportunity is re-triggered so the AI scorer
works with the richer content rather than the original snippet.
"""
import asyncio
from app.workers.celery_app import celery_app


def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _source_enrichment_config(db, opp) -> tuple[list[str] | None, bool]:
    detail_selectors = None
    use_playwright = False
    if opp.source_id:
        from app.models.source import Source
        source = db.get(Source, opp.source_id)
        if source and source.scraper_config:
            cfg = source.scraper_config
            cfg_selectors = cfg.get("detail_selectors")
            if cfg_selectors:
                detail_selectors = cfg_selectors if isinstance(cfg_selectors, list) else [cfg_selectors]
            use_playwright = bool(cfg.get("use_playwright", False))
    return detail_selectors, use_playwright


def _apply_page_enrichment(db, opp, result: dict, *, skip_pdf: bool = False) -> bool:
    from app.services.call_document_fetcher import (
        fetch_and_store_call_documents,
        merge_enrichment_text,
    )

    pdf_result = fetch_and_store_call_documents(
        db,
        opp,
        result.get("pdf_urls") or [],
        pdf_anchors=result.get("pdf_anchors") or {},
        skip_pdf=skip_pdf,
    )
    merged = merge_enrichment_text(
        result.get("description"),
        result.get("parsed_text"),
        pdf_result.get("merged_pdf_text") or "",
    )

    changed = False
    existing_desc_len = len(opp.description or "")
    new_desc = merged.get("description")
    if new_desc and len(new_desc) > existing_desc_len:
        opp.description = new_desc
        changed = True

    if merged.get("parsed_text"):
        existing_parsed_len = len(opp.parsed_text or "")
        if len(merged["parsed_text"]) > existing_parsed_len:
            opp.parsed_text = merged["parsed_text"]
            changed = True

    if merged.get("short_summary"):
        if not opp.short_summary or len(merged["short_summary"]) > len(opp.short_summary or ""):
            opp.short_summary = merged["short_summary"]
            changed = True

    if pdf_result.get("stored_count", 0) > 0:
        changed = True

    return changed


def _queue_post_enrichment(opportunity_id: str) -> None:
    # Route through the tagger first so universal taxonomy tags are written
    # before keyword scoring runs. The tagger task chains scoring + summary
    # internally once it completes.
    from app.workers.tagging_tasks import tag_and_embed_opportunity
    tag_and_embed_opportunity.delay(opportunity_id)


@celery_app.task(
    name="app.workers.enrichment_tasks.enrich_opportunity",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def enrich_opportunity(self, opportunity_id: str, skip_pdf: bool = False):
    """
    Fetch the full grant detail page for an opportunity and enrich its description.

    Skips if:
      - The opportunity has no URL
      - parsed_text is already populated (already enriched)

    On success, re-queues score_opportunity so scoring reflects the richer text.
    """
    import structlog
    logger = structlog.get_logger()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"status": "not_found"}

        if not opp.opportunity_url:
            return {"status": "no_url"}

        if opp.parsed_text:
            if opp.parsed_text == "[fetch_failed]":
                return {"status": "fetch_failed_permanent", "skipped": True}
            return {"status": "already_enriched"}

        detail_selectors, use_playwright = _source_enrichment_config(db, opp)
        from app.scrapers.detail_fetcher import DetailPageParser
        parser = DetailPageParser()

        try:
            result = parser.fetch_and_parse(
                opp.opportunity_url,
                detail_selectors,
                use_playwright=use_playwright,
            )
        except Exception as e:
            logger.error("Detail fetch exception", opp_id=opportunity_id, error=str(e))
            raise self.retry(exc=e)

        if result.get("error") and not result.get("pdf_urls"):
            error_str = result["error"]
            logger.warning(
                "Detail fetch returned error",
                opp_id=opportunity_id,
                url=opp.opportunity_url,
                error=error_str,
            )
            # Permanent failures (4xx HTTP, DNS resolution failure, or after all
            # retries exhausted) — mark the opportunity so it is never re-queued.
            # We set parsed_text to a sentinel so `not opp.parsed_text` is False
            # on the next discovery scan.
            is_permanent = (
                "HTTP 4" in error_str       # 403, 404, 410, etc.
                or "Name or service not known" in error_str
                or "nodename nor servname" in error_str
                or "No address associated" in error_str
                or self.request.retries >= self.max_retries
            )
            if is_permanent:
                if not opp.parsed_text:
                    opp.parsed_text = "[fetch_failed]"
                    db.commit()
                    logger.info(
                        "Marked opportunity fetch-failed (permanent)",
                        opp_id=opportunity_id,
                        url=opp.opportunity_url,
                        error=error_str,
                    )
                return {"status": "fetch_failed_permanent", "error": error_str}
            return {"status": "fetch_error", "error": error_str}

        changed = _apply_page_enrichment(db, opp, result, skip_pdf=skip_pdf)

        if changed:
            db.commit()
            logger.info(
                "Opportunity enriched",
                opp_id=opportunity_id,
                desc_len=len(opp.description or ""),
                pdf_count=len(result.get("pdf_urls") or []),
            )
            _queue_post_enrichment(opportunity_id)
        else:
            logger.info("Enrichment: no new content found", opp_id=opportunity_id)

        return {
            "status": "enriched" if changed else "no_content",
            "description_length": len(opp.description or ""),
        }


@celery_app.task(
    name="app.workers.enrichment_tasks.generate_ai_summary",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def generate_ai_summary(self, opportunity_id: str):
    """
    Generate a structured markdown AI summary for an opportunity.
    Stored in Opportunity.ai_summary for rich display in the frontend.
    """
    import structlog
    logger = structlog.get_logger()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"status": "not_found"}

        if not opp.title:
            return {"status": "missing_title"}

        # Skip if a full summary already exists — avoids redundant LLM calls on
        # re-enrichment and dedup re-queuing.
        if opp.ai_summary and len(opp.ai_summary) > 200:
            return {"status": "already_summarized"}

        # Skip low-fit opportunities — no point generating rich summaries for
        # irrelevant grants. fit_score=None means not yet scored; proceed.
        fit_score = opp.fit_score or 0
        if opp.fit_score is not None and fit_score < 25:
            return {"status": "skipped_low_fit", "fit_score": fit_score}

        # Tier: brief summary for medium-fit (25–54), full for high-fit (≥ 55)
        summary_tier = "brief" if fit_score < 55 else "full"

        # Cap description to avoid ballooning token usage — parsed_text can be
        # 10k–30k chars. 6000 chars covers all meaningful grant content.
        description_text = (opp.description or opp.parsed_text or "")[:6000]

        try:
            from app.ai.agents.opportunity_summarizer import generate_opportunity_summary
            result = _run_async(generate_opportunity_summary(
                title=opp.title,
                funder=opp.funder or "",
                description=description_text,
                eligibility=opp.eligibility_criteria or "",
                geography=", ".join(opp.geography or []),
                award_min=opp.award_min,
                award_max=opp.award_max,
                currency=opp.currency or "USD",
                deadline=str(opp.deadline) if opp.deadline else "",
                loi_deadline=str(opp.loi_deadline) if opp.loi_deadline else "",
                thematic_areas=opp.thematic_areas or [],
                opportunity_url=opp.opportunity_url or "",
                fit_score=opp.fit_score,
                fit_rationale=opp.fit_rationale or "",
                summary_tier=summary_tier,
            ))
            opp.ai_summary = result["full_summary"]
            if result["short_description"]:
                opp.short_summary = result["short_description"]
            db.commit()
            logger.info(
                "AI summary generated",
                opp_id=opportunity_id,
                summary_length=len(result["full_summary"]),
                short_desc_length=len(result["short_description"]),
            )
            return {"status": "ok", "length": len(result["full_summary"])}
        except Exception as e:
            logger.error("AI summary generation failed", opp_id=opportunity_id, error=str(e))
            raise self.retry(exc=e)


@celery_app.task(
    name="app.workers.enrichment_tasks.enrich_opportunity_force",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def enrich_opportunity_force(self, opportunity_id: str, skip_pdf: bool = False):
    """
    Force re-enrichment even if parsed_text already exists.
    Useful for manually re-fetching a page after updating source selectors.
    """
    import structlog
    logger = structlog.get_logger()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"status": "not_found"}
        if not opp.opportunity_url:
            return {"status": "no_url"}

        detail_selectors, use_playwright = _source_enrichment_config(db, opp)
        from app.scrapers.detail_fetcher import DetailPageParser
        parser = DetailPageParser()

        try:
            result = parser.fetch_and_parse(
                opp.opportunity_url,
                detail_selectors,
                use_playwright=use_playwright,
            )
        except Exception as e:
            logger.error("Force re-enrich fetch exception", opp_id=opportunity_id, error=str(e))
            raise self.retry(exc=e)

        if result.get("error") and not result.get("pdf_urls"):
            return {"status": "fetch_error", "error": result["error"]}

        _apply_page_enrichment(db, opp, result, skip_pdf=skip_pdf)
        db.commit()
        logger.info("Opportunity force-re-enriched", opp_id=opportunity_id)

        _queue_post_enrichment(opportunity_id)

        return {"status": "enriched", "description_length": len(opp.description or "")}
