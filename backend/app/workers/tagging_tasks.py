"""
Tagging and embedding tasks.

tag_and_embed_opportunity:
  1. Runs the universal grant tagger (gpt-4o-mini) to classify the grant
     and populate thematic_areas, keywords, geography.
  2. Generates a text embedding and stores it in Opportunity.embedding so
     the vector-similarity search leg can find semantically relevant grants.
  3. On success, chains the downstream scoring and summary tasks (replacing
     the old _queue_post_enrichment fan-out in enrichment_tasks.py).

This task sits between enrichment and scoring in the pipeline:
  enrich_opportunity → tag_and_embed_opportunity → score_opportunity
                                                  → rescore_opportunity_for_institutions
                                                  → generate_ai_summary (30s)
"""
import asyncio
from app.db_sync import get_sync_engine
from app.workers.celery_app import celery_app


def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _build_embed_text(opp, all_tags: list[str]) -> str:
    """
    Compose a compact text representation for embedding:
      title + all_tags (space-joined) + first 500 chars of description
    """
    parts = [opp.title or ""]
    if all_tags:
        parts.append(" ".join(all_tags))
    if opp.description:
        parts.append(opp.description[:500])
    elif opp.short_summary:
        parts.append(opp.short_summary[:300])
    return " ".join(p for p in parts if p)[:8000]


@celery_app.task(
    name="app.workers.tagging_tasks.tag_and_embed_opportunity",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def tag_and_embed_opportunity(self, opportunity_id: str):
    """
    Tag a grant with universal taxonomy labels, generate its embedding,
    then chain downstream scoring and summary tasks.

    Idempotent: if thematic_areas is already non-empty AND embedding is set,
    skips AI calls but still fires scoring tasks (in case they haven't run yet).
    """
    import structlog
    logger = structlog.get_logger()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = get_sync_engine()

    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"status": "not_found"}

        if not opp.title:
            return {"status": "missing_title"}

        already_tagged = bool(opp.thematic_areas)
        already_embedded = opp.embedding is not None

        if already_tagged and already_embedded:
            logger.info("Tagging skipped — already tagged and embedded", opp_id=opportunity_id)
            _queue_post_tagging(opportunity_id)
            return {"status": "already_tagged_and_embedded"}

        all_new_tags: list[str] = []

        # --- Step 1: tag classification ---
        if not already_tagged:
            try:
                from app.ai.agents.grant_tagger import tag_grant, merge_tags_into_opportunity

                tags = _run_async(tag_grant(
                    title=opp.title,
                    funder=opp.funder or "",
                    description=(opp.description or opp.parsed_text or "")[:2000],
                    eligibility=opp.eligibility_criteria or "",
                    geography=", ".join(opp.geography or []),
                ))

                changed = merge_tags_into_opportunity(opp, tags)
                if changed:
                    db.commit()
                    logger.info(
                        "Opportunity tagged",
                        opp_id=opportunity_id,
                        thematic_count=len(opp.thematic_areas or []),
                        keyword_count=len(opp.keywords or []),
                        geography_count=len(opp.geography or []),
                    )

                # Collect all tags for the embedding text
                for v in tags.values():
                    all_new_tags.extend(v)

            except Exception as e:
                logger.error("Tagging step failed", opp_id=opportunity_id, error=str(e))
                raise self.retry(exc=e)
        else:
            # Already tagged — use existing tags for embedding text
            all_new_tags = list(opp.thematic_areas or []) + list(opp.keywords or [])

        # --- Step 2: embedding generation ---
        if not already_embedded:
            try:
                from app.ai.client import get_embedding

                embed_text = _build_embed_text(opp, all_new_tags)
                if embed_text.strip():
                    embedding = _run_async(get_embedding(embed_text))
                    # Only store if we got a non-zero vector (get_embedding falls back
                    # to zeros on failure — we don't want to store a useless zero vector)
                    if embedding and any(v != 0.0 for v in embedding):
                        opp.embedding = embedding
                        db.commit()
                        logger.info("Embedding stored", opp_id=opportunity_id, dims=len(embedding))
                    else:
                        logger.warning("Embedding was all-zeros, skipping storage", opp_id=opportunity_id)

            except Exception as e:
                # Embedding failure is non-fatal — log and continue to scoring
                logger.error("Embedding generation failed", opp_id=opportunity_id, error=str(e))

    _queue_post_tagging(opportunity_id)
    return {"status": "ok", "tagged": not already_tagged, "embedded": not already_embedded}


def _queue_post_tagging(opportunity_id: str) -> None:
    """
    Fire scoring and summary tasks after tagging completes.
    Mirrors the old _queue_post_enrichment from enrichment_tasks, but now
    called from here so tags are available when the keyword scorer runs.
    """
    from app.workers.discovery_tasks import score_opportunity
    from app.workers.surfacing_tasks import rescore_opportunity_for_institutions
    from app.workers.enrichment_tasks import generate_ai_summary

    score_opportunity.delay(opportunity_id)
    rescore_opportunity_for_institutions.delay(opportunity_id)
    generate_ai_summary.apply_async(args=[opportunity_id], countdown=30)


@celery_app.task(
    name="app.workers.tagging_tasks.retag_opportunity",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def retag_opportunity(self, opportunity_id: str):
    """
    Force re-tag and re-embed an opportunity even if it already has tags/embedding.
    Useful for backfilling existing grants or testing prompt changes.
    """
    import structlog
    logger = structlog.get_logger()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.opportunity import Opportunity

    settings = get_settings()
    engine = get_sync_engine()

    with Session(engine) as db:
        opp = db.get(Opportunity, opportunity_id)
        if not opp:
            return {"status": "not_found"}

        if not opp.title:
            return {"status": "missing_title"}

        try:
            from app.ai.agents.grant_tagger import tag_grant, merge_tags_into_opportunity

            tags = _run_async(tag_grant(
                title=opp.title,
                funder=opp.funder or "",
                description=(opp.description or opp.parsed_text or "")[:2000],
                eligibility=opp.eligibility_criteria or "",
                geography=", ".join(opp.geography or []),
            ))

            # Force-overwrite thematic_areas and keywords (clear first, then merge)
            opp.thematic_areas = []
            opp.keywords = []
            merge_tags_into_opportunity(opp, tags)

            all_tags: list[str] = []
            for v in tags.values():
                all_tags.extend(v)

        except Exception as e:
            logger.error("Retag classification failed", opp_id=opportunity_id, error=str(e))
            raise self.retry(exc=e)

        try:
            from app.ai.client import get_embedding

            embed_text = _build_embed_text(opp, all_tags)
            if embed_text.strip():
                embedding = _run_async(get_embedding(embed_text))
                if embedding and any(v != 0.0 for v in embedding):
                    opp.embedding = embedding
        except Exception as e:
            logger.error("Retag embedding failed", opp_id=opportunity_id, error=str(e))

        db.commit()
        logger.info(
            "Opportunity retagged",
            opp_id=opportunity_id,
            thematic_count=len(opp.thematic_areas or []),
        )

    return {"status": "ok"}
