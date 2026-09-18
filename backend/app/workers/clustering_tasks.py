"""
Clustering tasks — build a semantic similarity graph over *all* opportunities,
detect Leiden communities, and compute a 2D atlas layout.

Pipeline:
  1. kNN graph via pgvector (``<=>`` cosine distance) in a LATERAL join, using
     the HNSW/IVFFlat index on ``opportunities.embedding``. Previously this was
     a brute-force sklearn ``NearestNeighbors`` over every embedding held in
     memory at once — O(n^2) distance work on 1536-d vectors plus ~300MB of
     resident float32 per 50k grants, which does not survive growth of the
     corpus. Postgres does the neighbour search against an index instead, and
     only (id, id, distance) triples cross the wire.

  2. Edge weight blends embedding similarity with taxonomy overlap:
       w = ALPHA * (1 - cosine_distance) + (1 - ALPHA) * jaccard(tags_i, tags_j)
     where tags = thematic_areas union keywords. Semantic similarity stays
     dominant; keyword overlap acts as a tiebreaker.

  3. Retention is **per node**, not global — see `services.graph_builder`. The
     old global top-N cap let a few dense clumps of near-duplicate grants
     consume the entire edge budget, leaving most nodes with no edges and the
     graph view rendering as unconnected dots.

  4. Leiden community detection (leidenalg, RBConfigurationVertexPartition) on
     the igraph representation. Leiden guarantees well-connected communities,
     fixing Louvain's disconnected-subset defect.
     (Traag, Waltman & van Eck, Sci. Rep. 2019)

  5. UMAP to 2D for the atlas layout, stored as umap_x / umap_y. Above
     ``UMAP_FIT_SAMPLE`` rows the reducer is fit on a sample and used to
     ``transform`` the remainder in chunks, so peak memory stays bounded
     regardless of corpus size.

  6. Communities are labelled by an LLM, largest first and capped, with a
     deterministic term-frequency fallback so labelling cost does not scale
     linearly with the number of communities.

References:
  Traag et al. (2019) From Louvain to Leiden. Sci Rep 9:5233.
  McInnes et al. (2018) UMAP. arXiv:1802.03426.
"""
import logging
import random

from celery import shared_task

# Re-exported for backwards compatibility — these moved to services.graph_builder
# so the retention policy could be unit-tested without a database.
from app.services.graph_builder import (  # noqa: F401
    ALPHA,
    EDGE_WEIGHT_THRESHOLD,
    blend_edge_weight,
    cap_edges,
    jaccard,
    top_k_per_node,
)

logger = logging.getLogger(__name__)

CLUSTER_COLORS = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
    "#14b8a6", "#a855f7", "#3b82f6", "#22c55e", "#fbbf24",
]

# Neighbours fetched per node from pgvector.
KNN_K = 15
# Edges retained per node after blending/thresholding. Lower than KNN_K so the
# stored graph is sparser than the candidate graph — this is the readable-atlas
# density, roughly what Connected-Papers-style layouts use.
EDGES_PER_NODE = 8
# Global safety cap, applied only *after* per-node selection. Sized for the
# whole corpus rather than a single view; the API pages a subgraph out of this.
MAX_STORED_EDGES = 400_000
# IVFFlat probe count for the kNN scan. The default of 1 gives poor recall and
# would produce a noticeably worse graph than brute force.
IVFFLAT_PROBES = 10
# HNSW search breadth. Same purpose as IVFFLAT_PROBES for the HNSW index that
# migration 059 creates where pgvector supports it.
HNSW_EF_SEARCH = 100
# Above this many embedded rows, UMAP is fit on a sample and used to transform
# the rest in chunks instead of fitting on everything.
UMAP_FIT_SAMPLE = 25_000
# Rows pulled per round trip when streaming embeddings for the layout.
EMBEDDING_STREAM_CHUNK = 2_000
# Communities labelled by the LLM (largest first). The rest get a deterministic
# label so cost does not grow with community count.
MAX_LLM_LABELLED_COMMUNITIES = 40
# Communities smaller than this are folded into the "assorted" bucket rather
# than cluttering the legend with singletons.
MIN_COMMUNITY_SIZE = 3

_EXCLUDED_STATUSES = ("archived", "duplicate")


@shared_task(name="app.workers.clustering_tasks.cluster_opportunities")
def cluster_opportunities():
    """Re-cluster every opportunity with an embedding."""
    import asyncio

    asyncio.run(_cluster_opportunities_async())


def _stopwords() -> set[str]:
    return {
        "the", "and", "for", "with", "from", "that", "this", "are", "was", "will",
        "grant", "grants", "funding", "fund", "call", "program", "programme",
        "award", "awards", "opportunity", "opportunities", "project", "projects",
        "research", "support", "new", "open", "application", "applications",
    }


def _fallback_label(titles: list[str]) -> str:
    """Deterministic label from the most frequent distinctive title terms.

    Used for small or overflow communities so the number of LLM calls stays
    bounded as the corpus grows.
    """
    from collections import Counter

    stop = _stopwords()
    counter: Counter = Counter()
    for title in titles:
        for token in (title or "").lower().replace("/", " ").split():
            token = "".join(ch for ch in token if ch.isalnum())
            if len(token) > 3 and token not in stop:
                counter[token] += 1
    top = [word.title() for word, _n in counter.most_common(3)]
    return " ".join(top) if top else "Assorted Grants"


async def _fetch_knn_edges(db, k: int) -> list[tuple[str, str, float]]:
    """kNN candidate edges straight out of pgvector.

    One LATERAL probe per node against the vector index, rather than an
    all-pairs distance computation in Python.
    """
    from sqlalchemy import text

    # Session-local, so this never leaks to other users of the pool. Which knob
    # applies depends on which index the planner picks (HNSW if migration 059
    # created it, otherwise IVFFlat) — set both, and treat either being absent
    # as non-fatal rather than losing the whole clustering run over a GUC.
    for guc, value in (("ivfflat.probes", IVFFLAT_PROBES), ("hnsw.ef_search", HNSW_EF_SEARCH)):
        try:
            await db.execute(text(f"SET LOCAL {guc} = {int(value)}"))
        except Exception as exc:
            logger.debug("Could not set %s (%s) — continuing with the default", guc, exc)
            await db.rollback()

    excluded = ", ".join(f"'{s}'" for s in _EXCLUDED_STATUSES)
    sql = text(
        f"""
        SELECT o.id AS src_id, nb.id AS tgt_id, nb.dist AS dist
        FROM opportunities o
        CROSS JOIN LATERAL (
            SELECT o2.id AS id, (o2.embedding <=> o.embedding) AS dist
            FROM opportunities o2
            WHERE o2.embedding IS NOT NULL
              AND o2.id <> o.id
              AND (o2.status IS NULL OR o2.status NOT IN ({excluded}))
            ORDER BY o2.embedding <=> o.embedding
            LIMIT :k
        ) nb
        WHERE o.embedding IS NOT NULL
          AND (o.status IS NULL OR o.status NOT IN ({excluded}))
        """
    )
    rows = (await db.execute(sql, {"k": k})).all()
    return [(r.src_id, r.tgt_id, 1.0 - float(r.dist)) for r in rows]


async def _compute_layout(db, ids: list[str]) -> dict[str, tuple[float, float]]:
    """UMAP 2D coordinates for every id, normalised to [0, 1].

    Streams embeddings in chunks. Above UMAP_FIT_SAMPLE the reducer is fit on a
    random sample and used to transform the remainder, so peak memory is a
    function of the sample size rather than the corpus size.
    """
    import numpy as np
    import umap
    from sqlalchemy import select

    from app.models.opportunity import Opportunity

    n = len(ids)
    if n < 10:
        return {}

    fit_target = min(n, UMAP_FIT_SAMPLE)
    # Deterministic sample so re-runs produce a stable map.
    rng = random.Random(42)
    fit_ids = set(ids if n <= fit_target else rng.sample(ids, fit_target))

    fit_rows: list[np.ndarray] = []
    fit_order: list[str] = []

    async def _load(target_ids: list[str]):
        """Fetch embeddings for specific ids in bounded chunks."""
        for start in range(0, len(target_ids), EMBEDDING_STREAM_CHUNK):
            chunk = target_ids[start : start + EMBEDDING_STREAM_CHUNK]
            rows = (
                await db.execute(
                    select(Opportunity.id, Opportunity.embedding).where(
                        Opportunity.id.in_(chunk)
                    )
                )
            ).all()
            yield [(oid, emb) for oid, emb in rows if emb is not None]

    # Only the sampled ids are pulled — transferring the whole corpus to keep a
    # quarter of it would waste bandwidth proportional to the corpus size.
    fit_id_list = [oid for oid in ids if oid in fit_ids]
    async for batch in _load(fit_id_list):
        for oid, emb in batch:
            fit_rows.append(np.asarray(emb, dtype=np.float32))
            fit_order.append(oid)

    if len(fit_rows) < 10:
        return {}

    matrix = np.vstack(fit_rows)
    reducer = umap.UMAP(
        n_components=2,
        random_state=42,
        metric="cosine",
        n_neighbors=min(15, len(fit_rows) - 1),
        min_dist=0.1,
    )
    fitted = reducer.fit_transform(matrix)

    coords: dict[str, np.ndarray] = {oid: fitted[i] for i, oid in enumerate(fit_order)}
    del matrix, fit_rows

    # Transform anything not in the fit sample, in bounded chunks.
    remaining = [oid for oid in ids if oid not in coords]
    if remaining:
        logger.info("UMAP: transforming %d rows outside the fit sample", len(remaining))
        async for batch in _load(remaining):
            if not batch:
                continue
            chunk_matrix = np.vstack([np.asarray(e, dtype=np.float32) for _o, e in batch])
            try:
                transformed = reducer.transform(chunk_matrix)
            except Exception as exc:
                logger.warning("UMAP transform failed for a chunk (%s) — skipping", exc)
                continue
            for (oid, _emb), xy in zip(batch, transformed):
                coords[oid] = xy

    if not coords:
        return {}

    stacked = np.vstack(list(coords.values()))
    lo = stacked.min(axis=0)
    hi = stacked.max(axis=0)
    span = np.where(hi - lo > 0, hi - lo, 1.0)
    return {
        oid: (float((xy[0] - lo[0]) / span[0]), float((xy[1] - lo[1]) / span[1]))
        for oid, xy in coords.items()
    }


async def _cluster_opportunities_async():
    """Async implementation of the kNN + Leiden + UMAP pipeline."""
    try:
        import numpy as np  # noqa: F401
    except ImportError:
        logger.error("numpy not installed — cannot cluster")
        return
    try:
        import igraph as ig
        import leidenalg
    except ImportError:
        logger.error("python-igraph / leidenalg not installed — cannot cluster")
        return
    try:
        import umap  # noqa: F401
    except ImportError:
        logger.error("umap-learn not installed — cannot compute UMAP positions")
        return

    from sqlalchemy import delete, select

    from app.ai.client import chat_complete
    from app.database import AsyncSessionLocal
    from app.models.opportunity import Opportunity
    from app.models.opportunity_cluster import OpportunityCluster
    from app.models.opportunity_edge import OpportunityEdge

    async with AsyncSessionLocal() as db:
        try:
            # ── 1. Node metadata (no embeddings — those stream later) ─────────
            rows = (
                await db.execute(
                    select(
                        Opportunity.id,
                        Opportunity.title,
                        Opportunity.thematic_areas,
                        Opportunity.keywords,
                    ).where(
                        Opportunity.embedding.isnot(None),
                        Opportunity.status.notin_(_EXCLUDED_STATUSES),
                    )
                )
            ).all()

            if len(rows) < 10:
                logger.info("Not enough opportunities with embeddings to cluster (%d)", len(rows))
                return

            ids = [r[0] for r in rows]
            titles = {r[0]: r[1] for r in rows}
            tags = {
                r[0]: {t.lower() for t in (r[2] or [])} | {kw.lower() for kw in (r[3] or [])}
                for r in rows
            }
            n = len(ids)
            logger.info("Clustering %d opportunities", n)

            # ── 2. kNN candidates from pgvector, blended with tag overlap ─────
            candidates = await _fetch_knn_edges(db, min(KNN_K, n - 1))
            logger.info("Fetched %d kNN candidate edges", len(candidates))

            known = set(ids)
            blended = [
                (src, tgt, blend_edge_weight(sim, jaccard(tags.get(src, set()), tags.get(tgt, set()))))
                for src, tgt, sim in candidates
                if src in known and tgt in known
            ]

            # ── 3. Per-node retention (never a global cap) ────────────────────
            edges = cap_edges(top_k_per_node(blended, EDGES_PER_NODE), MAX_STORED_EDGES)
            logger.info("Retained %d edges (%.1f per node)", len(edges), 2 * len(edges) / max(n, 1))

            # ── 4. Leiden communities ─────────────────────────────────────────
            index_of = {oid: i for i, oid in enumerate(ids)}
            ig_edges = [(index_of[a], index_of[b]) for a, b, _w in edges]
            weights = [w for _a, _b, w in edges]

            g = ig.Graph(n=n, edges=ig_edges, directed=False)
            g.es["weight"] = weights
            partition = leidenalg.find_partition(
                g, leidenalg.RBConfigurationVertexPartition, weights="weight", seed=42
            )
            membership = partition.membership
            logger.info("Leiden found %d communities from %d nodes", len(set(membership)), n)

            # Group members, folding tiny communities into one bucket so the
            # legend stays readable.
            members: dict[int, list[str]] = {}
            for idx, comm in enumerate(membership):
                members.setdefault(comm, []).append(ids[idx])
            ordered = sorted(members.items(), key=lambda kv: len(kv[1]), reverse=True)
            big = [(c, m) for c, m in ordered if len(m) >= MIN_COMMUNITY_SIZE]
            small = [oid for _c, m in ordered if len(m) < MIN_COMMUNITY_SIZE for oid in m]

            # ── 5. Layout ─────────────────────────────────────────────────────
            coords = await _compute_layout(db, ids)
            logger.info("Computed UMAP coordinates for %d nodes", len(coords))

            # ── 6. Rebuild clusters + edges ───────────────────────────────────
            for stale in (await db.execute(select(OpportunityCluster))).scalars().all():
                await db.delete(stale)
            await db.execute(delete(OpportunityEdge))
            await db.flush()

            cluster_of: dict[str, int] = {}
            for rank, (_comm, member_ids) in enumerate(big):
                member_titles = [titles.get(m) or "" for m in member_ids]
                if rank < MAX_LLM_LABELLED_COMMUNITIES:
                    try:
                        sample = "\n".join(f"- {t}" for t in member_titles[:8])
                        label = (
                            await chat_complete(
                                messages=[
                                    {"role": "system", "content": "You name grant topic clusters in 3-5 words."},
                                    {"role": "user", "content": f"Name this cluster:\n{sample}\n\nRespond with ONLY 3-5 words."},
                                ],
                                agent_name="cluster_labeler",
                                temperature=0.1,
                                max_tokens=20,
                            )
                        ).strip().strip('"').strip("'")[:100] or _fallback_label(member_titles)
                    except Exception as exc:
                        logger.warning("Failed to label community %d: %s", rank, exc)
                        label = _fallback_label(member_titles)
                else:
                    label = _fallback_label(member_titles)

                cluster = OpportunityCluster(label=label, color=CLUSTER_COLORS[rank % len(CLUSTER_COLORS)])
                db.add(cluster)
                await db.flush()
                for m in member_ids:
                    cluster_of[m] = cluster.id

            if small:
                misc = OpportunityCluster(label="Assorted Grants", color="#94a3b8")
                db.add(misc)
                await db.flush()
                for m in small:
                    cluster_of[m] = misc.id

            # ── 7. Bulk-write node assignments ────────────────────────────────
            # One statement per chunk rather than one UPDATE per row: the old
            # per-row loop issued a round trip per opportunity.
            payload = [
                {
                    "b_id": oid,
                    "b_cluster": cluster_of.get(oid),
                    "b_x": coords.get(oid, (None, None))[0],
                    "b_y": coords.get(oid, (None, None))[1],
                }
                for oid in ids
            ]
            from sqlalchemy import bindparam, text as sa_text

            stmt = (
                sa_text(
                    "UPDATE opportunities SET cluster_id = :b_cluster, "
                    "umap_x = :b_x, umap_y = :b_y WHERE id = :b_id"
                )
                .bindparams(bindparam("b_cluster"), bindparam("b_x"), bindparam("b_y"), bindparam("b_id"))
            )
            for start in range(0, len(payload), 1000):
                await db.execute(stmt, payload[start : start + 1000])

            # ── 8. Bulk-insert edges ──────────────────────────────────────────
            edge_payload = [{"source_id": a, "target_id": b, "weight": w} for a, b, w in edges]
            for start in range(0, len(edge_payload), 2000):
                await db.execute(
                    OpportunityEdge.__table__.insert(), edge_payload[start : start + 2000]
                )

            await db.commit()

            # ── 9. Build and store the shared atlas ───────────────────────────
            # Identical for every user, so it is written once here rather than
            # assembled per request. Serving the whole corpus any other way
            # would mean touching every node and edge on every page load.
            await _store_atlas(db, ids, edges, cluster_of)

            logger.info(
                "Clustering complete: %d communities, %d opportunities, %d edges",
                len(big) + (1 if small else 0), n, len(edges),
            )

        except Exception as exc:
            logger.exception("Clustering task failed: %s", exc)
            await db.rollback()


async def _store_atlas(db, ids, edges, cluster_of) -> None:
    """Serialize the full graph and upsert it as the current snapshot."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.models.graph_snapshot import GraphSnapshot
    from app.models.opportunity import Opportunity
    from app.models.opportunity_cluster import OpportunityCluster
    from app.services.graph_atlas import ATLAS_FORMAT_VERSION, build_atlas_payload, encode_atlas

    try:
        # Only the fields the atlas renders — deliberately not ai_summary or the
        # full tag arrays, which would dominate a whole-corpus payload and are
        # fetched on demand when a node is opened.
        meta_rows = (
            await db.execute(
                select(
                    Opportunity.id,
                    Opportunity.title,
                    Opportunity.funder,
                    Opportunity.deadline,
                    Opportunity.fit_score,
                    Opportunity.thematic_areas,
                    Opportunity.umap_x,
                    Opportunity.umap_y,
                ).where(Opportunity.id.in_(ids))
            )
        ).all()

        nodes = [
            {
                "id": r.id,
                "title": r.title,
                "funder": r.funder,
                "deadline": str(r.deadline) if r.deadline else None,
                "fit_score": r.fit_score,
                "cluster_id": cluster_of.get(r.id),
                # One theme is enough to colour by; the full array is not.
                "theme": (r.thematic_areas or [None])[0],
                "x": r.umap_x if r.umap_x is not None else 0.5,
                "y": r.umap_y if r.umap_y is not None else 0.5,
            }
            for r in meta_rows
        ]

        clusters = [
            {"id": c.id, "label": c.label, "color": c.color}
            for c in (await db.execute(select(OpportunityCluster))).scalars().all()
        ]

        payload = build_atlas_payload(
            nodes, edges, clusters,
            computed_at=datetime.now(timezone.utc).isoformat(),
        )
        blob, etag = encode_atlas(payload)

        snapshot = await db.get(GraphSnapshot, "opportunities")
        if snapshot is None:
            snapshot = GraphSnapshot(kind="opportunities")
            db.add(snapshot)
        snapshot.payload = blob
        snapshot.etag = etag
        snapshot.node_count = payload["node_count"]
        snapshot.edge_count = payload["edge_count"]
        snapshot.format_version = ATLAS_FORMAT_VERSION
        snapshot.computed_at = datetime.now(timezone.utc)
        await db.commit()

        logger.info(
            "Atlas stored: %d nodes, %d edges, %.1f KB gzipped",
            payload["node_count"], payload["edge_count"], len(blob) / 1024,
        )
    except Exception as exc:
        # The clustering results are already committed; a failed atlas build
        # must not lose them. The previous snapshot stays served until the next
        # run succeeds.
        logger.exception("Failed to build graph atlas: %s", exc)
        await db.rollback()
