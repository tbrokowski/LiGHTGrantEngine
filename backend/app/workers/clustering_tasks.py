"""
Clustering tasks — assign opportunities to topic clusters using HDBSCAN on embeddings.
"""
import logging
import json
from celery import shared_task

logger = logging.getLogger(__name__)

CLUSTER_COLORS = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
    "#14b8a6", "#a855f7", "#3b82f6", "#22c55e", "#fbbf24",
]


@shared_task(name="app.workers.clustering_tasks.cluster_opportunities")
def cluster_opportunities():
    """
    Re-cluster all opportunities with embeddings using HDBSCAN.
    Assigns cluster_id to each opportunity and creates/updates cluster labels.
    """
    import asyncio
    asyncio.run(_cluster_opportunities_async())


async def _cluster_opportunities_async():
    """Async implementation of the clustering task."""
    try:
        import numpy as np
    except ImportError:
        logger.error("numpy not installed — cannot cluster")
        return

    try:
        from sklearn.preprocessing import normalize
        from sklearn.cluster import MiniBatchKMeans
    except ImportError:
        logger.error("scikit-learn not installed — cannot cluster")
        return

    from sqlalchemy import select, update
    from app.database import AsyncSessionLocal
    from app.models.opportunity import Opportunity
    from app.models.opportunity_cluster import OpportunityCluster
    from app.ai.client import chat_complete

    async with AsyncSessionLocal() as db:
        # Load opportunities with embeddings
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

        # Normalize embeddings
        embeddings = normalize(embeddings)

        # Determine k: sqrt(n/2) is a reasonable heuristic
        k = max(3, min(20, int(np.sqrt(len(rows) / 2))))
        logger.info("Clustering %d opportunities into %d clusters", len(rows), k)

        kmeans = MiniBatchKMeans(n_clusters=k, random_state=42, n_init=3)
        labels = kmeans.fit_predict(embeddings)

        # Delete old clusters
        all_clusters = (await db.execute(select(OpportunityCluster))).scalars().all()
        for c in all_clusters:
            await db.delete(c)
        await db.flush()

        # Build cluster membership
        cluster_members: dict[int, list] = {i: [] for i in range(k)}
        for idx, label in enumerate(labels):
            cluster_members[int(label)].append({
                "title": titles[idx],
                "themes": themes_list[idx][:3],
            })

        # Generate cluster labels via AI
        cluster_id_map: dict[int, int] = {}
        for cluster_idx in range(k):
            members = cluster_members[cluster_idx][:8]
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
                logger.warning("Failed to label cluster %d: %s", cluster_idx, exc)
                label = f"Topic Cluster {cluster_idx + 1}"

            color = CLUSTER_COLORS[cluster_idx % len(CLUSTER_COLORS)]
            new_cluster = OpportunityCluster(label=label, color=color)
            db.add(new_cluster)
            await db.flush()
            cluster_id_map[cluster_idx] = new_cluster.id

        # Update opportunity cluster_ids
        for idx, opp_id in enumerate(ids):
            new_cluster_id = cluster_id_map[int(labels[idx])]
            await db.execute(
                update(Opportunity)
                .where(Opportunity.id == opp_id)
                .values(cluster_id=new_cluster_id)
            )

        await db.commit()
        logger.info("Clustering complete: %d clusters, %d opportunities assigned", k, len(ids))

    except Exception as exc:
        logger.exception("Clustering task failed: %s", exc)
