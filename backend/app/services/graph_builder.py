"""Pure graph-construction helpers for the opportunity/archive similarity graphs.

The graph view is a semantic atlas: every grant is a node, edges connect
semantically near grants, and Leiden communities give the coloring. Getting the
*edge retention policy* right is what separates a readable atlas from a cloud of
disconnected dots.

The previous pipeline kept a global top-N edges by weight
(`sorted(...)[:MAX_STORED_EDGES]`). On any sizable corpus that is the wrong
policy: the highest-weight pairs are near-duplicate grants, which concentrate in
a handful of dense clumps, so the cap is exhausted by a few clusters and the
majority of nodes are left with no edges at all. The graph then renders as
evenly-repelled dots with zero visible structure.

`top_k_per_node` replaces it: the retained set is the *union of each node's own
top-k edges*, so edge budget is spread across the corpus rather than won by the
densest region. Every node that has any candidate keeps at least one edge, which
is what guarantees a connected-looking map.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Hashable, Iterable, Sequence

# Weight given to embedding (semantic) similarity vs. keyword/taxonomy overlap
# in the blended edge weight. Semantic stays dominant; keyword overlap tiebreaks.
ALPHA = 0.7

# Edges below this blended weight are dropped — except each node's single best
# edge, which is always kept (see `top_k_per_node`).
EDGE_WEIGHT_THRESHOLD = 0.30


def jaccard(tags_a: set, tags_b: set) -> float:
    """Jaccard overlap of two tag sets. Returns 0.0 when either side is empty."""
    if not tags_a or not tags_b:
        return 0.0
    union = tags_a | tags_b
    if not union:
        return 0.0
    return len(tags_a & tags_b) / len(union)


def blend_edge_weight(semantic_weight: float, tag_jaccard: float, alpha: float = ALPHA) -> float:
    """Blend embedding-similarity weight with keyword/taxonomy Jaccard overlap."""
    return alpha * semantic_weight + (1 - alpha) * tag_jaccard


def top_k_per_node(
    candidates: Iterable[tuple[Hashable, Hashable, float]],
    k: int,
    *,
    threshold: float = EDGE_WEIGHT_THRESHOLD,
    keep_best_always: bool = True,
) -> list[tuple[Hashable, Hashable, float]]:
    """Retain the union of each node's top-`k` edges.

    `candidates` is an iterable of (source, target, weight); direction is
    ignored and the result is de-duplicated to one undirected edge per pair.

    Edges below `threshold` are dropped, except that when `keep_best_always` is
    set each node's single strongest edge survives regardless. That backbone is
    what prevents isolated nodes: a grant in a sparse corner of embedding space
    has a best neighbour that is genuinely its nearest, even if the absolute
    similarity is modest, and showing that link is more informative than
    floating it unconnected.
    """
    if k <= 0:
        return []

    incident: dict[Hashable, list[tuple[float, Hashable]]] = defaultdict(list)
    for src, tgt, weight in candidates:
        if src == tgt:
            continue
        incident[src].append((weight, tgt))
        incident[tgt].append((weight, src))

    kept: dict[tuple[Hashable, Hashable], float] = {}
    for node, edges in incident.items():
        edges.sort(key=lambda t: t[0], reverse=True)
        for rank, (weight, other) in enumerate(edges[:k]):
            # Each node's best edge is its backbone link — keep it even below
            # threshold so the node is never orphaned.
            if weight < threshold and not (keep_best_always and rank == 0):
                continue
            pair = (node, other) if str(node) <= str(other) else (other, node)
            # Same pair can arrive from both endpoints; keep the higher weight.
            if pair not in kept or kept[pair] < weight:
                kept[pair] = weight

    return [(a, b, w) for (a, b), w in kept.items()]


def cap_edges(
    edges: Sequence[tuple[Hashable, Hashable, float]], max_edges: int
) -> list[tuple[Hashable, Hashable, float]]:
    """Safety cap applied *after* per-node selection.

    Ordering by weight here is safe in a way the old global cap was not: the
    input is already spread across the corpus, so trimming the tail removes the
    weakest links rather than every link belonging to sparse regions.
    """
    if max_edges <= 0 or len(edges) <= max_edges:
        return list(edges)
    return sorted(edges, key=lambda e: e[2], reverse=True)[:max_edges]


def expand_neighborhood(
    seed_ids: Iterable[Hashable],
    adjacency: dict[Hashable, list[Hashable]],
    *,
    max_nodes: int,
    hops: int = 1,
) -> set[Hashable]:
    """Grow a seed set outward along graph edges, up to `max_nodes`.

    The graph endpoint previously took an arbitrary slice of opportunities and
    then asked for edges whose endpoints were *both* inside it. On a sparse kNN
    graph over a large corpus the induced subgraph of a random sample is almost
    entirely edgeless — which is why the view reported zero connections. Pulling
    in each seed's neighbours instead yields a subgraph that is connected by
    construction.
    """
    seen: set[Hashable] = set(seed_ids)
    if len(seen) >= max_nodes:
        return set(list(seen)[:max_nodes])

    frontier = list(seen)
    for _hop in range(max(0, hops)):
        next_frontier: list[Hashable] = []
        for node in frontier:
            for neighbour in adjacency.get(node, ()):
                if neighbour in seen:
                    continue
                seen.add(neighbour)
                next_frontier.append(neighbour)
                if len(seen) >= max_nodes:
                    return seen
        if not next_frontier:
            break
        frontier = next_frontier
    return seen
