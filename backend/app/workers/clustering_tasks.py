"""
Clustering tasks — assign opportunities to Leiden communities using a kNN
cosine-similarity graph on OpenAI embeddings, then compute UMAP 2D positions.

Algorithm pipeline (Scanpy-style, validated on high-dimensional embedding data):
  1. Normalise 1536-dim OpenAI embeddings (L2).
  2. Build a k-nearest-neighbour graph (k=15, cosine similarity) via sklearn.
     Edges are weighted by similarity = 1 - cosine_distance and thresholded at 0.3.
  3. Run Leiden community detection (leidenalg, RBConfigurationVertexPartition)
     on the igraph representation of the kNN graph.
     → Leiden guarantees well-connected communities, fixing Louvain's
       disconnected-subset defect. (Traag, Waltman & van Eck, Sci. Rep. 2019)
  4. Reduce embeddings to 2D with UMAP (umap-learn, cosine metric) and store
     the coordinates as umap_x / umap_y on each Opportunity row.
     → Semantically similar grants land near each other in the initial layout.
  5. Store weighted kNN edges (above threshold) in the opportunity_edges table
     for the force-graph renderer.
  6. AI-label each discovered community (3–5 words via existing GPT call).

References:
  Traag et al. (2019) From Louvain to Leiden. Sci Rep 9:5233.
  McInnes et al. (2018) UMAP. arXiv:1802.03426.
  Abbe (2018) Community Detection and Stochastic Block Models. JMLR 18(177).
"""
import logging

logger = logging.getLogger(__name__)

CLUSTER_COLORS = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
    "#14b8a6", "#a855f7", "#3b82f6", "#22c55e", "#fbbf24",
]

# Edges with cosine similarity below this threshold are dropped before Leiden.
EDGE_WEIGHT_THRESHOLD = 0.30
# kNN neighbours per node
KNN_K = 15
# Maximum edges written to opportunity_edges (cap for wire-friendly API responses)
MAX_STORED_EDGES = 5000


from celery import shared_task


@shared_task(name="app.workers.clustering_tasks.cluster_opportunities")
def cluster_opportunities():
    """
    Re-cluster all opportunities with embeddings using Leiden community detection.
    Assigns cluster_id and umap_x/umap_y to each opportunity and writes
    similarity edges to opportunity_edges.
    """
    import asyncio
    asyncio.run(_cluster_opportunities_async())


async def _cluster_opportunities_async():
    """Async implementation of the Leiden + UMAP clustering pipeline."""
    try:
        import numpy as np
    except ImportError:
        logger.error("numpy not installed — cannot cluster")
        return

    try:
        from sklearn.preprocessing import normalize
        from sklearn.neighbors import NearestNeighbors
    except ImportError:
        logger.error("scikit-learn not installed — cannot cluster")
        return

    try:
        import igraph as ig
        import leidenalg
    except ImportError:
        logger.error("python-igraph / leidenalg not installed — cannot cluster")
        return

    try:
        import umap
    except ImportError:
        logger.error("umap-learn not installed — cannot compute UMAP positions")
        return

    from sqlalchemy import select, update, delete, text
    from app.database import AsyncSessionLocal
    from app.models.opportunity import Opportunity
    from app.models.opportunity_cluster import OpportunityCluster
    from app.models.opportunity_edge import OpportunityEdge
    from app.ai.client import chat_complete

    async with AsyncSessionLocal() as db:
        try:
            # ── 1. Load opportunities with embeddings ─────────────────────────
            result = await db.execute(
                select(Opportunity.id, Opportunity.embedding, Opportunity.title, Opportunity.thematic_areas)
                .where(Opportunity.embedding.isnot(None))
            )
            rows = result.all()

            if len(rows) < 10:
                logger.info("Not enough opportunities with embeddings to cluster (%d)", len(rows))
                return

            ids = [r[0] for r in rows]
            embeddings = np.array([r[1] for r in rows], dtype=np.float32)
            titles = [r[2] for r in rows]
            themes_list = [r[3] or [] for r in rows]

            n = len(ids)
            logger.info("Clustering %d opportunities", n)

            # ── 2. Normalise (L2) and build kNN similarity graph ──────────────
            embeddings = normalize(embeddings)

            k = min(KNN_K, n - 1)
            nn = NearestNeighbors(n_neighbors=k, metric="cosine", algorithm="auto", n_jobs=-1)
            nn.fit(embeddings)
            distances, indices = nn.kneighbors(embeddings)

            # Build edge list: weight = 1 - cosine_distance
            edges = []
            weights = []
            for i in range(n):
                for j_pos in range(k):
                    j = int(indices[i, j_pos])
                    if j <= i:
                        continue
                    w = float(1.0 - distances[i, j_pos])
                    if w >= EDGE_WEIGHT_THRESHOLD:
                        edges.append((i, j))
                        weights.append(w)

            # ── 3. Build igraph and run Leiden community detection ────────────
            g = ig.Graph(n=n, edges=edges, directed=False)
            g.es["weight"] = weights

            # RBConfigurationVertexPartition with modularity-based resolution
            partition = leidenalg.find_partition(
                g,
                leidenalg.RBConfigurationVertexPartition,
                weights="weight",
                seed=42,
            )
            labels = partition.membership  # list[int], length == n
            n_communities = len(set(labels))
            logger.info("Leiden found %d communities from %d nodes", n_communities, n)

            # ── 4. UMAP 2D layout ─────────────────────────────────────────────
            reducer = umap.UMAP(
                n_components=2,
                random_state=42,
                metric="cosine",
                n_neighbors=min(15, n - 1),
                min_dist=0.1,
            )
            coords_2d = reducer.fit_transform(embeddings)  # shape (n, 2)
            # Normalise to [0, 1] for stable storage (frontend rescales)
            coords_min = coords_2d.min(axis=0)
            coords_max = coords_2d.max(axis=0)
            coords_range = np.where(coords_max - coords_min > 0, coords_max - coords_min, 1.0)
            coords_norm = (coords_2d - coords_min) / coords_range

            # ── 5. Wipe and recreate clusters ─────────────────────────────────
            all_clusters = (await db.execute(select(OpportunityCluster))).scalars().all()
            for c in all_clusters:
                await db.delete(c)
            await db.flush()

            # Clear old edges
            await db.execute(delete(OpportunityEdge))
            await db.flush()

            # Build community membership maps
            community_members: dict[int, list] = {i: [] for i in range(n_communities)}
            for idx, comm in enumerate(labels):
                community_members[comm].append({
                    "title": titles[idx],
                    "themes": themes_list[idx][:3],
                })

            # ── 6. AI-label each community ────────────────────────────────────
            cluster_id_map: dict[int, int] = {}
            for comm_idx in range(n_communities):
                members = community_members[comm_idx][:8]
                member_text = "\n".join(
                    f"- {m['title']} ({', '.join(m['themes'])})" for m in members
                )
                try:
                    label_response = await chat_complete(
                        messages=[
                            {"role": "system", "content": "You name grant topic clusters in 3-5 words."},
                            {"role": "user", "content": f"Name this cluster:\n{member_text}\n\nRespond with ONLY 3-5 words."},
                        ],
                        agent_name="cluster_labeler",
                        temperature=0.1,
                        max_tokens=20,
                    )
                    label = label_response.strip().strip('"').strip("'")[:100]
                except Exception as exc:
                    logger.warning("Failed to label community %d: %s", comm_idx, exc)
                    label = f"Topic Cluster {comm_idx + 1}"

                color = CLUSTER_COLORS[comm_idx % len(CLUSTER_COLORS)]
                new_cluster = OpportunityCluster(label=label, color=color)
                db.add(new_cluster)
                await db.flush()
                cluster_id_map[comm_idx] = new_cluster.id

            # ── 7. Update opportunity cluster_ids and UMAP coordinates ────────
            for idx, opp_id in enumerate(ids):
                await db.execute(
                    update(Opportunity)
                    .where(Opportunity.id == opp_id)
                    .values(
                        cluster_id=cluster_id_map[int(labels[idx])],
                        umap_x=float(coords_norm[idx, 0]),
                        umap_y=float(coords_norm[idx, 1]),
                    )
                )

            # ── 8. Store kNN edges in opportunity_edges ───────────────────────
            # Sort by weight descending and cap at MAX_STORED_EDGES
            edge_triples = sorted(
                zip(edges, weights), key=lambda x: x[1], reverse=True
            )[:MAX_STORED_EDGES]

            id_array = ids  # list for index lookup
            for (i, j), w in edge_triples:
                db.add(OpportunityEdge(
                    source_id=id_array[i],
                    target_id=id_array[j],
                    weight=w,
                ))

            await db.commit()
            logger.info(
                "Clustering complete: %d communities, %d opportunities, %d edges stored",
                n_communities, n, len(edge_triples),
            )

        except Exception as exc:
            logger.exception("Clustering task failed: %s", exc)
