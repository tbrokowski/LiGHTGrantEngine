"""
Retroactive deduplication task.

Scans all existing opportunities and marks confirmed duplicates so they are
hidden from listing endpoints (which filter status != 'duplicate').

Algorithm — four passes in decreasing confidence order:

  Pass 1 — External ID grouping (opportunity_number or program_name)
            Highest confidence; auto-marks duplicates.

  Pass 2 — Normalised URL grouping (only grant-specific URLs)
            High confidence; auto-marks duplicates.

  Pass 3 — Normalised title + funder prefix + deadline within 60 days
            High confidence; auto-marks duplicates.

  Pass 4 — Normalised title + funder prefix (no deadline constraint)
            Medium confidence; flags as POSSIBLE_DUPLICATE only.

Within each group the "best" (canonical) record is kept; others are suppressed.
Canonical selection score:
  +3  has parsed_text
  +2  has description
  +1  fit_score > 0
  +1  oldest date_discovered (tie-breaker: prefer original)
"""
import structlog
from datetime import date
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.workers.celery_app import celery_app

logger = structlog.get_logger()

_BATCH_SIZE = 500


def _quality_score(row: dict) -> tuple[int, Any]:
    """Return (score, negative_discovered_ts) for canonical selection.

    Higher score = better canonical. Ties broken by oldest discovery date
    (smallest timestamp, so we negate for max-sort purposes).
    """
    score = 0
    if row.get("parsed_text"):
        score += 3
    if row.get("description"):
        score += 2
    if (row.get("fit_score") or 0) > 0:
        score += 1
    # Prefer oldest record (original); negate so max() picks the oldest
    discovered = row.get("date_discovered")
    neg_ts = -discovered.timestamp() if discovered else 0
    return (score, neg_ts)


def _funder_prefix(funder: str | None) -> str:
    """Canonical funder prefix (mirrors opportunity_dedup._funder_prefix)."""
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
    """Keep the best record in the group; mark the rest."""
    from app.models.opportunity import DuplicateStatus

    if len(group) < 2:
        return

    # Pick the canonical record
    canonical = max(group, key=_quality_score)
    canonical_id = canonical["id"]

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


@celery_app.task(
    name="app.workers.dedup_tasks.deduplicate_existing_opportunities",
    bind=True,
    max_retries=1,
)
def deduplicate_existing_opportunities(self):
    """Scan all opportunities and mark duplicates.

    Safe to run repeatedly — idempotent.
    Returns a summary dict with counts.
    """
    from app.config import get_settings
    from sqlalchemy import create_engine

    settings = get_settings()
    engine = create_engine(settings.database_url)

    stats = {"confirmed": 0, "possible": 0, "groups_processed": 0}

    with Session(engine) as db:
        # Load all non-duplicate opportunities into memory.
        # We select only the fields needed for grouping and scoring.
        rows = db.execute(text("""
            SELECT
                id,
                lower(title)                        AS title_lower,
                opportunity_url,
                lower(opportunity_url)              AS url_lower,
                opportunity_number,
                upper(opportunity_number)           AS opp_num_upper,
                program_name,
                upper(program_name)                 AS prog_upper,
                funder,
                deadline,
                source_id,
                date_discovered,
                parsed_text IS NOT NULL             AS has_parsed_text,
                description IS NOT NULL             AS has_description,
                fit_score,
                status,
                duplicate_status
            FROM opportunities
            WHERE status != 'duplicate'
            ORDER BY date_discovered ASC NULLS LAST
        """)).mappings().all()

        # Convert to plain dicts for manipulation
        all_rows = []
        for r in rows:
            all_rows.append({
                "id": r["id"],
                "title_lower": r["title_lower"] or "",
                "opportunity_url": r["opportunity_url"],
                "url_lower": r["url_lower"] or "",
                "opportunity_number": r["opportunity_number"],
                "opp_num_upper": r["opp_num_upper"] or "",
                "program_name": r["program_name"],
                "prog_upper": r["prog_upper"] or "",
                "funder": r["funder"],
                "deadline": r["deadline"],
                "source_id": r["source_id"],
                "date_discovered": r["date_discovered"],
                "parsed_text": r["has_parsed_text"],
                "description": r["has_description"],
                "fit_score": r["fit_score"],
            })

        logger.info("dedup_task: loaded rows", count=len(all_rows))

        already_marked: set[str] = set()

        # ── Pass 1: External ID (opportunity_number / program_name) ──────────
        ext_id_groups: dict[str, list[dict]] = {}
        for row in all_rows:
            from app.services.opportunity_dedup import _extract_external_id
            ext_id = _extract_external_id(
                row["program_name"],
                row["opportunity_number"],
                row["opportunity_url"],
            )
            if ext_id:
                ext_id_groups.setdefault(ext_id, []).append(row)

        for ext_id, group in ext_id_groups.items():
            if len(group) < 2:
                continue
            _mark_duplicates(db, group, confirmed=True, stats=stats)
            stats["groups_processed"] += 1
            for row in group:
                already_marked.add(row["id"])

        db.commit()
        logger.info("dedup_task: pass 1 done", **stats)

        # ── Pass 2: Specific URL ──────────────────────────────────────────────
        url_groups: dict[str, list[dict]] = {}
        for row in all_rows:
            if row["id"] in already_marked:
                continue
            url = row["opportunity_url"]
            if url and _is_specific_url(url):
                norm = _normalize_url(url)
                url_groups.setdefault(norm, []).append(row)

        for norm_url, group in url_groups.items():
            if len(group) < 2:
                continue
            _mark_duplicates(db, group, confirmed=True, stats=stats)
            stats["groups_processed"] += 1
            for row in group:
                already_marked.add(row["id"])

        db.commit()
        logger.info("dedup_task: pass 2 done", **stats)

        # ── Pass 3: Title + funder prefix + deadline within 60 days ──────────
        # Group by (title_lower, funder_prefix) first, then check deadlines
        title_funder_groups: dict[tuple, list[dict]] = {}
        for row in all_rows:
            if row["id"] in already_marked:
                continue
            key = (row["title_lower"], _funder_prefix(row["funder"]))
            title_funder_groups.setdefault(key, []).append(row)

        for key, group in title_funder_groups.items():
            if len(group) < 2:
                continue
            # Sub-group by deadline proximity: cluster records within 60 days of each other
            deadline_clusters = _cluster_by_deadline(group, window_days=60)
            for cluster in deadline_clusters:
                if len(cluster) < 2:
                    continue
                _mark_duplicates(db, cluster, confirmed=True, stats=stats)
                stats["groups_processed"] += 1
                for row in cluster:
                    already_marked.add(row["id"])

        db.commit()
        logger.info("dedup_task: pass 3 done", **stats)

        # ── Pass 4: Title + funder prefix (possible duplicates only) ─────────
        for key, group in title_funder_groups.items():
            remaining = [r for r in group if r["id"] not in already_marked]
            if len(remaining) < 2:
                continue
            _mark_duplicates(db, remaining, confirmed=False, stats=stats)
            stats["groups_processed"] += 1

        db.commit()
        logger.info("dedup_task: pass 4 done", **stats)

    logger.info(
        "deduplicate_existing_opportunities complete",
        confirmed_duplicates=stats["confirmed"],
        possible_duplicates=stats["possible"],
        groups_processed=stats["groups_processed"],
    )
    return stats


def _cluster_by_deadline(rows: list[dict], window_days: int) -> list[list[dict]]:
    """Group rows into clusters where every pair is within window_days of each other.

    Rows without a deadline are placed in their own single-row cluster so they
    don't pull unrelated records together.
    """
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

    # Each no-deadline row is its own cluster
    for row in no_deadline:
        clusters.append([row])

    return clusters
