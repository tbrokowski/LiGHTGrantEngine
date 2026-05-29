"""
Retroactive deduplication — synchronous core + optional Celery wrapper.

The core function `run_dedup(engine)` can be called directly from:
  - The admin endpoint (via asyncio executor, no Celery needed)
  - App startup lifespan
  - The Celery task below (when workers are available)

Algorithm — four passes in decreasing confidence order:

  Pass 1 — External ID (opportunity_number / program_name)  → auto-mark duplicate
  Pass 2 — Normalised specific-URL match                    → auto-mark duplicate
  Pass 3 — Title + funder prefix + deadline within 60 days  → auto-mark duplicate
  Pass 4 — Title + funder prefix only                       → flag POSSIBLE_DUPLICATE

Within each group the "best" canonical record is kept; others are suppressed.
Canonical selection score:
  +3  has parsed_text
  +2  has description
  +1  fit_score > 0
  +1  oldest date_discovered (tie-breaker: prefer original)
"""
import structlog
from datetime import date
from typing import Any

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _quality_score(row: dict) -> tuple[int, Any]:
    score = 0
    if row.get("parsed_text"):
        score += 3
    if row.get("description"):
        score += 2
    if (row.get("fit_score") or 0) > 0:
        score += 1
    discovered = row.get("date_discovered")
    neg_ts = -discovered.timestamp() if discovered else 0
    return (score, neg_ts)


def _funder_prefix(funder: str | None) -> str:
    from app.services.opportunity_dedup import _funder_prefix as _fp
    return _fp(funder or "")


def _is_specific_url(url: str | None) -> bool:
    from app.services.opportunity_dedup import _is_specific_url as _isu
    return _isu(url or "")


def _normalize_url(url: str | None) -> str:
    from app.scrapers.base import _normalize_url as _nu
    return _nu(url or "")


def _mark_duplicates(
    db: Session,
    group: list[dict],
    confirmed: bool,
    stats: dict,
) -> None:
    from app.models.opportunity import DuplicateStatus

    if len(group) < 2:
        return

    canonical_id = max(group, key=_quality_score)["id"]

    for row in group:
        if row["id"] == canonical_id:
            continue
        opp_id = row["id"]
        if confirmed:
            db.execute(
                text(
                    "UPDATE opportunities "
                    "SET status = 'duplicate', duplicate_status = :ds "
                    "WHERE id = :id AND status != 'duplicate'"
                ),
                {"ds": DuplicateStatus.CONFIRMED_DUPLICATE, "id": opp_id},
            )
            stats["confirmed"] += 1
        else:
            db.execute(
                text(
                    "UPDATE opportunities "
                    "SET duplicate_status = :ds "
                    "WHERE id = :id AND status != 'duplicate' "
                    "AND duplicate_status = 'unique'"
                ),
                {"ds": DuplicateStatus.POSSIBLE_DUPLICATE, "id": opp_id},
            )
            stats["possible"] += 1


def _cluster_by_deadline(rows: list[dict], window_days: int) -> list[list[dict]]:
    no_deadline = [r for r in rows if r["deadline"] is None]
    with_deadline = sorted(
        [r for r in rows if r["deadline"] is not None],
        key=lambda r: r["deadline"],
    )

    clusters: list[list[dict]] = []
    current: list[dict] = []

    for row in with_deadline:
        if not current:
            current.append(row)
        else:
            earliest = current[0]["deadline"]
            if isinstance(earliest, date) and isinstance(row["deadline"], date):
                if abs((row["deadline"] - earliest).days) <= window_days:
                    current.append(row)
                else:
                    clusters.append(current)
                    current = [row]
            else:
                current.append(row)

    if current:
        clusters.append(current)

    for row in no_deadline:
        clusters.append([row])

    return clusters


# ---------------------------------------------------------------------------
# Core dedup logic — callable directly (no Celery required)
# ---------------------------------------------------------------------------

def run_dedup(engine: Engine) -> dict:
    """Scan all opportunities and mark duplicates. Idempotent.

    Args:
        engine: A SQLAlchemy Engine connected to the application database.

    Returns:
        stats dict: {"confirmed": int, "possible": int, "groups_processed": int}
    """
    from app.services.opportunity_dedup import _extract_external_id

    stats = {"confirmed": 0, "possible": 0, "groups_processed": 0}

    with Session(engine) as db:
        rows = db.execute(text("""
            SELECT
                id,
                lower(title)                        AS title_lower,
                opportunity_url,
                opportunity_number,
                program_name,
                funder,
                deadline,
                source_id,
                date_discovered,
                parsed_text IS NOT NULL             AS has_parsed_text,
                description IS NOT NULL             AS has_description,
                fit_score
            FROM opportunities
            WHERE status != 'duplicate'
            ORDER BY date_discovered ASC NULLS LAST
        """)).mappings().all()

        all_rows = [
            {
                "id": r["id"],
                "title_lower": r["title_lower"] or "",
                "opportunity_url": r["opportunity_url"],
                "opportunity_number": r["opportunity_number"],
                "program_name": r["program_name"],
                "funder": r["funder"],
                "deadline": r["deadline"],
                "source_id": r["source_id"],
                "date_discovered": r["date_discovered"],
                "parsed_text": r["has_parsed_text"],
                "description": r["has_description"],
                "fit_score": r["fit_score"],
            }
            for r in rows
        ]

        logger.info("run_dedup: loaded rows", count=len(all_rows))
        already_marked: set[str] = set()

        # ── Pass 1: External ID ───────────────────────────────────────────────
        ext_id_groups: dict[str, list[dict]] = {}
        for row in all_rows:
            ext_id = _extract_external_id(
                row["program_name"],
                row["opportunity_number"],
                row["opportunity_url"],
            )
            if ext_id:
                ext_id_groups.setdefault(ext_id, []).append(row)

        for group in ext_id_groups.values():
            if len(group) < 2:
                continue
            _mark_duplicates(db, group, confirmed=True, stats=stats)
            stats["groups_processed"] += 1
            already_marked.update(r["id"] for r in group)

        db.commit()
        logger.info("run_dedup: pass 1 complete", **stats)

        # ── Pass 2: Specific URL ──────────────────────────────────────────────
        url_groups: dict[str, list[dict]] = {}
        for row in all_rows:
            if row["id"] in already_marked:
                continue
            url = row["opportunity_url"]
            if url and _is_specific_url(url):
                url_groups.setdefault(_normalize_url(url), []).append(row)

        for group in url_groups.values():
            if len(group) < 2:
                continue
            _mark_duplicates(db, group, confirmed=True, stats=stats)
            stats["groups_processed"] += 1
            already_marked.update(r["id"] for r in group)

        db.commit()
        logger.info("run_dedup: pass 2 complete", **stats)

        # ── Pass 3: Title + funder prefix + deadline proximity ────────────────
        title_funder_groups: dict[tuple, list[dict]] = {}
        for row in all_rows:
            if row["id"] in already_marked:
                continue
            key = (row["title_lower"], _funder_prefix(row["funder"]))
            title_funder_groups.setdefault(key, []).append(row)

        for group in title_funder_groups.values():
            if len(group) < 2:
                continue
            for cluster in _cluster_by_deadline(group, window_days=60):
                if len(cluster) < 2:
                    continue
                _mark_duplicates(db, cluster, confirmed=True, stats=stats)
                stats["groups_processed"] += 1
                already_marked.update(r["id"] for r in cluster)

        db.commit()
        logger.info("run_dedup: pass 3 complete", **stats)

        # ── Pass 4: Title + funder prefix (possible duplicates) ───────────────
        for group in title_funder_groups.values():
            remaining = [r for r in group if r["id"] not in already_marked]
            if len(remaining) < 2:
                continue
            _mark_duplicates(db, remaining, confirmed=False, stats=stats)
            stats["groups_processed"] += 1

        db.commit()
        logger.info("run_dedup: pass 4 complete", **stats)

    logger.info(
        "run_dedup complete",
        confirmed=stats["confirmed"],
        possible=stats["possible"],
        groups=stats["groups_processed"],
    )
    return stats


# ---------------------------------------------------------------------------
# Celery task wrapper (optional — only used when Celery workers are running)
# ---------------------------------------------------------------------------

try:
    from app.workers.celery_app import celery_app

    @celery_app.task(
        name="app.workers.dedup_tasks.deduplicate_existing_opportunities",
        bind=True,
        max_retries=1,
    )
    def deduplicate_existing_opportunities(self):
        """Celery-wrapped dedup task. Idempotent."""
        from app.config import get_settings
        from sqlalchemy import create_engine

        engine = create_engine(get_settings().database_url)
        return run_dedup(engine)

except Exception:
    pass
