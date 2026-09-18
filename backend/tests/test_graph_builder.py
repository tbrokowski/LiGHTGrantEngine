"""Unit tests for the similarity-graph construction policy.

These target the two defects that made the graph view render 500 unconnected
dots: a global edge cap that starved sparse regions, and a node-sampling
strategy that induced edges on an arbitrary subset.
"""
import pytest

from app.services.graph_builder import (
    EDGE_WEIGHT_THRESHOLD,
    blend_edge_weight,
    cap_edges,
    expand_neighborhood,
    jaccard,
    top_k_per_node,
)


def _degree(edges):
    deg = {}
    for a, b, _w in edges:
        deg[a] = deg.get(a, 0) + 1
        deg[b] = deg.get(b, 0) + 1
    return deg


# ── The starvation bug ───────────────────────────────────────────────────────

def test_per_node_retention_does_not_starve_sparse_regions():
    """The core regression. A global top-N cap is exhausted by one dense clump
    of near-duplicate grants, leaving every other node with zero edges."""
    candidates = []
    # A dense clump of 12 near-duplicates, all mutually very similar.
    clump = [f"dup{i}" for i in range(12)]
    for i, a in enumerate(clump):
        for b in clump[i + 1:]:
            candidates.append((a, b, 0.97))
    # 40 sparse-region nodes, each with a real but weaker nearest neighbour.
    for i in range(40):
        candidates.append((f"sparse{i}", f"sparse{i}_nbr", 0.55))

    kept = top_k_per_node(candidates, k=8)
    degree = _degree(kept)

    orphans = [n for n in (f"sparse{i}" for i in range(40)) if degree.get(n, 0) == 0]
    assert orphans == [], f"{len(orphans)} sparse nodes left unconnected"

    # For contrast: a naive global cap sized to the clump keeps nothing else.
    naive = sorted(candidates, key=lambda e: e[2], reverse=True)[:66]
    naive_degree = _degree(naive)
    assert all(naive_degree.get(f"sparse{i}", 0) == 0 for i in range(40))


def test_every_node_with_a_candidate_keeps_an_edge():
    candidates = [(f"n{i}", f"n{i+1}", 0.1 + i * 0.01) for i in range(50)]
    kept = top_k_per_node(candidates, k=4)
    degree = _degree(kept)
    involved = {e for c in candidates for e in (c[0], c[1])}
    assert all(degree.get(n, 0) >= 1 for n in involved)


def test_best_edge_survives_below_threshold():
    """A grant in a sparse corner of embedding space still has a true nearest
    neighbour; floating it unconnected is less informative than showing it."""
    weak = EDGE_WEIGHT_THRESHOLD - 0.15
    kept = top_k_per_node([("a", "b", weak)], k=8)
    assert len(kept) == 1
    assert kept[0][2] == pytest.approx(weak)


def test_weak_non_best_edges_are_dropped():
    candidates = [("a", "b", 0.9), ("a", "c", 0.05), ("a", "d", 0.04)]
    kept = top_k_per_node(candidates, k=8)
    pairs = {(min(a, b), max(a, b)) for a, b, _w in kept}
    assert ("a", "b") in pairs
    # c and d keep their own best edge (to a), since they have no alternative.
    # But they must not add extra sub-threshold links beyond that.
    assert len(kept) <= 3


def test_k_bounds_each_node_s_own_selection():
    """k caps how many edges a node contributes. A hub can still exceed k in
    total degree when other nodes independently choose it as their best
    neighbour — that is intended, and is what keeps leaves connected."""
    # Each leaf already has k stronger partners, so its own top-k excludes the
    # hub — isolating the hub's selection as the only thing k has to bound.
    candidates = [("hub", f"leaf{i}", 0.50 - i * 0.001) for i in range(30)]
    candidates += [
        (f"leaf{i}", f"partner{i}_{p}", 0.95)
        for i in range(30)
        for p in range(6)
    ]

    kept = top_k_per_node(candidates, k=5)
    degree = _degree(kept)
    assert degree["hub"] == 5, f"hub kept {degree['hub']} edges, expected k=5"

    # And the hub kept its *strongest* five, not an arbitrary five.
    hub_partners = {b if a == "hub" else a for a, b, _w in kept if "hub" in (a, b)}
    assert hub_partners == {f"leaf{i}" for i in range(5)}


def test_undirected_deduplication():
    kept = top_k_per_node([("a", "b", 0.8), ("b", "a", 0.8)], k=4)
    assert len(kept) == 1


def test_self_loops_are_dropped():
    assert top_k_per_node([("a", "a", 0.99)], k=4) == []


def test_empty_and_zero_k():
    assert top_k_per_node([], k=8) == []
    assert top_k_per_node([("a", "b", 0.9)], k=0) == []


# ── Capping ──────────────────────────────────────────────────────────────────

def test_cap_edges_keeps_strongest_and_is_a_noop_under_limit():
    edges = [("a", "b", 0.3), ("c", "d", 0.9), ("e", "f", 0.6)]
    assert cap_edges(edges, 10) == edges
    capped = cap_edges(edges, 2)
    assert len(capped) == 2
    assert {w for _a, _b, w in capped} == {0.9, 0.6}


# ── Neighbourhood expansion ──────────────────────────────────────────────────

def test_expansion_pulls_in_neighbours_of_seeds():
    adjacency = {"a": ["b", "c"], "b": ["a"], "c": ["a", "d"], "d": ["c"]}
    got = expand_neighborhood(["a"], adjacency, max_nodes=10, hops=1)
    assert got == {"a", "b", "c"}


def test_expansion_respects_max_nodes():
    adjacency = {"seed": [f"n{i}" for i in range(100)]}
    got = expand_neighborhood(["seed"], adjacency, max_nodes=10, hops=1)
    assert len(got) == 10
    assert "seed" in got


def test_expansion_handles_isolated_seeds():
    got = expand_neighborhood(["lonely"], {}, max_nodes=50, hops=1)
    assert got == {"lonely"}


def test_expansion_two_hops_reaches_further():
    adjacency = {"a": ["b"], "b": ["a", "c"], "c": ["b"]}
    assert expand_neighborhood(["a"], adjacency, max_nodes=10, hops=1) == {"a", "b"}
    assert expand_neighborhood(["a"], adjacency, max_nodes=10, hops=2) == {"a", "b", "c"}


def test_expansion_yields_a_connected_subgraph_where_sampling_does_not():
    """A random node sample induces almost no edges on a sparse kNN graph —
    the original cause of '500 grants, 0 connections'."""
    # Ring lattice: each node linked to the next. 1000 nodes, degree 2.
    n = 1000
    edges = [(f"n{i}", f"n{(i + 1) % n}") for i in range(n)]
    adjacency = {}
    for a, b in edges:
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)

    import random
    rng = random.Random(0)
    sample = set(rng.sample([f"n{i}" for i in range(n)], 50))
    induced = [(a, b) for a, b in edges if a in sample and b in sample]
    assert len(induced) <= 5, "sampling should induce almost nothing"

    expanded = expand_neighborhood(sample, adjacency, max_nodes=1000, hops=1)
    induced_after = [(a, b) for a, b in edges if a in expanded and b in expanded]
    assert len(induced_after) >= 50


# ── Weight blending (moved from test_clustering_weights) ─────────────────────

def test_jaccard_and_blend():
    assert jaccard({"a", "b"}, {"a", "b"}) == 1.0
    assert jaccard({"a"}, {"b"}) == 0.0
    assert jaccard(set(), {"a"}) == 0.0
    assert blend_edge_weight(1.0, 0.0, alpha=0.7) == pytest.approx(0.7)
    assert blend_edge_weight(0.0, 1.0, alpha=0.7) == pytest.approx(0.3)


def test_clustering_tasks_still_reexports_weight_helpers():
    """test_clustering_weights.py imports these from the task module."""
    from app.workers.clustering_tasks import ALPHA, blend_edge_weight as b, jaccard as j

    assert 0 < ALPHA < 1
    assert j({"x"}, {"x"}) == 1.0
    assert b(1.0, 1.0) == pytest.approx(1.0)
