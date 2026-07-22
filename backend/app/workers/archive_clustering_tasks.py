"""
Archive clustering task — assign grant archives to Leiden communities using a
kNN cosine-similarity graph built from weighted centroid embeddings derived from
each archive's indexed ProposalSection embeddings.

Algorithm pipeline:
  1. Load all GrantArchive rows where indexing_status='complete'.
  2. For each archive, load its ProposalSection embeddings (where embedding IS
     NOT NULL) and compute a weighted centroid:
       - High-signal sections (abstract, executive_summary) weight ×2.0
       - Core-content sections (specific_aims, problem_statement) weight ×1.5–1.8
       - Supporting sections (methods, impact_statement) weight ×1.3
       - General sections weight ×1.0, unknown sections ×0.8
     The centroid is L2-normalised. Archives with fewer than MIN_SECTIONS embedded
     sections are excluded from clustering (insufficient signal) but keep their
     existing coordinates.
  3. Store the normalised centroid in grant_archives.embedding.
  4. Build a kNN graph (k=10, cosine metric, sklearn NearestNeighbors). Edge
     weight blends centroid-embedding similarity with theme overlap (same
     ALPHA-weighted blend as app.workers.clustering_tasks) and is thresholded
     at EDGE_WEIGHT_THRESHOLD=0.35.
  5. Run Leiden community detection (leidenalg RBConfigurationVertexPartition,
     weight="weight", seed=42) on the igraph representation.
     → Guarantees well-connected communities. (Traag et al. Sci Rep 2019)
  6. Reduce embeddings to 2D via UMAP (cosine, n_neighbors=min(10,n-1),
     min_dist=0.15) and normalise to [0,1].
  7. Wipe archive_clusters and archive_edges, recreate with new values.
  8. AI-label each community with 3–5 words (title+outcome+funder samples).
  9. Write cluster_id, umap_x, umap_y back to grant_archives.

References:
  Traag, Waltman & van Eck (2019) From Louvain to Leiden. Sci Rep 9:5233.
  McInnes et al. (2018) UMAP. arXiv:1802.03426.
"""
import logging

logger = logging.getLogger(__name__)

# Section type weights — reflect information density for cross-archive similarity
SECTION_WEIGHTS: dict[str, float] = {
    "abstract": 2.0,
    "executive_summary": 2.0,
    "specific_aims": 1.8,
    "problem_statement": 1.5,
    "methods": 1.3,
    "impact_statement": 1.3,
    "background": 1.0,
    "objectives": 1.0,
    "innovation": 1.0,
    "theory_of_change": 1.0,
    "justification": 1.0,
}
DEFAULT_WEIGHT = 0.8

# Minimum number of embedded sections before an archive is included in clustering
MIN_SECTIONS = 2

KNN_K = 10
EDGE_WEIGHT_THRESHOLD = 0.35
MAX_STORED_EDGES = 1000

CLUSTER_COLORS = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
    "#14b8a6", "#a855f7", "#3b82f6", "#22c55e", "#fbbf24",
]

from celery import shared_task


@shared_task(name="app.workers.archive_clustering_tasks.cluster_archives")
def cluster_archives() -> None:
    """Re-cluster all indexed archives using Leiden + UMAP on centroid embeddings."""
    import asyncio
    asyncio.run(_cluster_archives_async())


async def _cluster_archives_async() -> None:
    try:
        import numpy as np
    except ImportError:
        logger.error("numpy not installed — cannot cluster archives")
        return

    try:
        from sklearn.preprocessing import normalize
        from sklearn.neighbors import NearestNeighbors
    except ImportError:
        logger.error("scikit-learn not installed — cannot cluster archives")
        return

    try:
        import igraph as ig
        import leidenalg
    except ImportError:
        logger.error("python-igraph / leidenalg not installed — cannot cluster archives")
        return

    try:
        import umap
    except ImportError:
        logger.error("umap-learn not installed — cannot compute UMAP for archives")
        return

    from sqlalchemy import select, update, delete
    from app.database import AsyncSessionLocal
    from app.models.archive import GrantArchive
    from app.models.archive_cluster import ArchiveCluster
    from app.models.archive_edge import ArchiveEdge
    from app.models.section import ProposalSection
    from app.ai.client import chat_complete
    from app.workers.clustering_tasks import jaccard, blend_edge_weight

    async with AsyncSessionLocal() as db:
        try:
            # ── 1. Load completed archives ────────────────────────────────────
            archives_result = await db.execute(
                select(
                    GrantArchive.id,
                    GrantArchive.title,
                    GrantArchive.funder,
                    GrantArchive.outcome,
                    GrantArchive.themes,
                    GrantArchive.call_year,
                )
                .where(GrantArchive.indexing_status == "complete")
            )
            archives = archives_result.all()

            if not archives:
                logger.info("No completed archives to cluster")
                return

            archive_ids = [r[0] for r in archives]
            archive_meta = {
                r[0]: {
                    "title": r[1],
                    "funder": r[2],
                    "outcome": r[3],
                    "themes": r[4] or [],
                    "year": r[5],
                }
                for r in archives
            }

            logger.info("Loading section embeddings for %d archives", len(archive_ids))

            # ── 2. Load section embeddings, compute weighted centroids ─────────
            sections_result = await db.execute(
                select(
                    ProposalSection.archive_id,
                    ProposalSection.section_type,
                    ProposalSection.embedding,
                )
                .where(
                    ProposalSection.archive_id.in_(archive_ids),
                    ProposalSection.embedding.isnot(None),
                )
            )
            sections_rows = sections_result.all()

            # Group by archive
            sections_by_archive: dict[str, list[tuple[str, list]]] = {}
            for archive_id, section_type, embedding in sections_rows:
                sections_by_archive.setdefault(archive_id, []).append(
                    (section_type or "other", embedding)
                )

            # Compute centroids
            valid_ids: list[str] = []
            centroids: list[np.ndarray] = []

            for archive_id in archive_ids:
                secs = sections_by_archive.get(archive_id, [])
                if len(secs) < MIN_SECTIONS:
                    continue

                weighted_sum = np.zeros(1536, dtype=np.float64)
                total_weight = 0.0
                for stype, emb in secs:
                    w = SECTION_WEIGHTS.get(stype, DEFAULT_WEIGHT)
                    weighted_sum += w * np.array(emb, dtype=np.float64)
                    total_weight += w

                centroid = weighted_sum / total_weight
                norm = np.linalg.norm(centroid)
                if norm < 1e-10:
                    continue
                centroids.append((centroid / norm).astype(np.float32))
                valid_ids.append(archive_id)

            n = len(valid_ids)
            if n < 3:
                logger.info(
                    "Only %d archives have sufficient section embeddings to cluster "
                    "(minimum 3 required)", n
                )
                return

            logger.info("Clustering %d archives with sufficient embeddings", n)
            embeddings = np.array(centroids, dtype=np.float32)
            tags_list = [
                {t.lower() for t in (archive_meta[aid]["themes"] or [])} for aid in valid_ids
            ]

            # Store centroid embeddings back to grant_archives (batched)
            for idx, archive_id in enumerate(valid_ids):
                await db.execute(
                    update(GrantArchive)
                    .where(GrantArchive.id == archive_id)
                    .values(embedding=embeddings[idx].tolist())
                )

            # ── 3. Normalize and build kNN graph ──────────────────────────────
            embeddings = normalize(embeddings)
            k = min(KNN_K, n - 1)
            nn = NearestNeighbors(n_neighbors=k, metric="cosine", algorithm="auto", n_jobs=-1)
            nn.fit(embeddings)
            distances, indices = nn.kneighbors(embeddings)

            edges: list[tuple[int, int]] = []
            weights: list[float] = []
            for i in range(n):
                for j_pos in range(k):
                    j = int(indices[i, j_pos])
                    if j <= i:
                        continue
                    w_semantic = float(1.0 - distances[i, j_pos])
                    w = blend_edge_weight(w_semantic, jaccard(tags_list[i], tags_list[j]))
                    if w >= EDGE_WEIGHT_THRESHOLD:
                        edges.append((i, j))
                        weights.append(w)

            # ── 4. Build igraph and run Leiden ────────────────────────────────
            g = ig.Graph(n=n, edges=edges, directed=False)
            g.es["weight"] = weights

            partition = leidenalg.find_partition(
                g,
                leidenalg.RBConfigurationVertexPartition,
                weights="weight",
                seed=42,
            )
            labels = partition.membership
            n_communities = len(set(labels))
            logger.info("Leiden found %d communities from %d archive nodes", n_communities, n)

            # ── 5. UMAP 2D ────────────────────────────────────────────────────
            reducer = umap.UMAP(
                n_components=2,
                random_state=42,
                metric="cosine",
                n_neighbors=min(10, n - 1),
                min_dist=0.15,
            )
            coords_2d = reducer.fit_transform(embeddings)
            coords_min = coords_2d.min(axis=0)
            coords_max = coords_2d.max(axis=0)
            coords_range = np.where(
                coords_max - coords_min > 0, coords_max - coords_min, 1.0
            )
            coords_norm = (coords_2d - coords_min) / coords_range

            # ── 6. Recreate clusters table ────────────────────────────────────
            await db.execute(delete(ArchiveEdge))
            existing_clusters = (
                await db.execute(select(ArchiveCluster))
            ).scalars().all()
            for c in existing_clusters:
                await db.delete(c)
            await db.flush()

            # Build per-community member samples for AI labeling
            community_members: dict[int, list[dict]] = {
                i: [] for i in range(n_communities)
            }
            for idx, comm in enumerate(labels):
                community_members[comm].append(archive_meta[valid_ids[idx]])

            # ── 7. AI-label communities ───────────────────────────────────────
            cluster_id_map: dict[int, int] = {}
            for comm_idx in range(n_communities):
                members = community_members[comm_idx][:8]
                member_text = "\n".join(
                    "- {title} [{funder}] ({outcome}, {year})".format(
                        title=m["title"],
                        funder=m["funder"] or "unknown funder",
                        outcome=m["outcome"] or "unknown",
                        year=m["year"] or "n/a",
                    )
                    for m in members
                )
                try:
                    label_response = await chat_complete(
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "You name grant archive topic clusters in 3-5 words. "
                                    "Each cluster is a group of past grant proposals. "
                                    "Name the thematic area or research domain, not the funders."
                                ),
                            },
                            {
                                "role": "user",
                                "content": (
                                    f"Name this archive cluster:\n{member_text}\n\n"
                                    "Respond with ONLY 3-5 words."
                                ),
                            },
                        ],
                        agent_name="archive_cluster_labeler",
                        temperature=0.1,
                        max_tokens=20,
                    )
                    label = label_response.strip().strip('"').strip("'")[:100]
                except Exception as exc:
                    logger.warning("Failed to label archive community %d: %s", comm_idx, exc)
                    label = f"Archive Cluster {comm_idx + 1}"

                color = CLUSTER_COLORS[comm_idx % len(CLUSTER_COLORS)]
                new_cluster = ArchiveCluster(label=label, color=color)
                db.add(new_cluster)
                await db.flush()
                cluster_id_map[comm_idx] = new_cluster.id

            # ── 8. Update archive rows with cluster_id + UMAP coords ──────────
            for idx, archive_id in enumerate(valid_ids):
                await db.execute(
                    update(GrantArchive)
                    .where(GrantArchive.id == archive_id)
                    .values(
                        cluster_id=cluster_id_map[int(labels[idx])],
                        umap_x=float(coords_norm[idx, 0]),
                        umap_y=float(coords_norm[idx, 1]),
                    )
                )

            # ── 9. Store kNN edges (top MAX_STORED_EDGES by weight) ───────────
            edge_triples = sorted(
                zip(edges, weights), key=lambda x: x[1], reverse=True
            )[:MAX_STORED_EDGES]

            for (i, j), w in edge_triples:
                db.add(
                    ArchiveEdge(
                        source_id=valid_ids[i],
                        target_id=valid_ids[j],
                        weight=w,
                    )
                )

            await db.commit()
            logger.info(
                "Archive clustering complete: %d communities, %d archives, %d edges",
                n_communities,
                n,
                len(edge_triples),
            )

        except Exception as exc:
            logger.exception("Archive clustering task failed: %s", exc)
