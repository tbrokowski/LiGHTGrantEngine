"""Unit tests for the precomputed whole-corpus atlas encoding."""
import json

import pytest

from app.services.graph_atlas import (
    ATLAS_FORMAT_VERSION,
    build_atlas_payload,
    decode_atlas,
    encode_atlas,
)


def _nodes(n, start=0):
    return [
        {
            "id": f"opp-{i:06d}-aaaa-bbbb-cccc-ddddeeeeffff",
            "title": f"Research Grant Programme Number {i} for Global Health",
            "funder": f"Funder {i % 50}",
            "deadline": "2026-06-30",
            "fit_score": i % 100,
            "cluster_id": i % 12,
            "theme": f"theme{i % 20}",
            "x": (i % 100) / 100,
            "y": (i // 100 % 100) / 100,
        }
        for i in range(start, start + n)
    ]


def test_roundtrip_preserves_nodes_and_edges():
    nodes = _nodes(5)
    edges = [(nodes[0]["id"], nodes[1]["id"], 0.87), (nodes[2]["id"], nodes[3]["id"], 0.42)]
    clusters = [{"id": 1, "label": "Global Health", "color": "#6366f1"}]

    payload = build_atlas_payload(nodes, edges, clusters, computed_at="2026-09-18T00:00:00Z")
    blob, etag = encode_atlas(payload)
    back = decode_atlas(blob)

    assert back["v"] == ATLAS_FORMAT_VERSION
    assert back["node_count"] == 5
    assert back["edge_count"] == 2
    assert back["nodes"]["id"][0] == nodes[0]["id"]
    assert back["clusters"][0]["label"] == "Global Health"
    assert len(etag) == 32


def test_edges_are_index_encoded_not_id_encoded():
    """Index pairs instead of uuid pairs — at four edges per node the difference
    dominates a whole-corpus payload."""
    nodes = _nodes(3)
    edges = [(nodes[0]["id"], nodes[2]["id"], 0.9)]
    payload = build_atlas_payload(nodes, edges, [])
    assert payload["edges"]["s"] == [0]
    assert payload["edges"]["t"] == [2]
    # No uuid should appear anywhere in the serialized edge block.
    assert "opp-" not in json.dumps(payload["edges"])


def test_edges_to_unknown_nodes_are_dropped_not_raised():
    """Nodes and edges are produced by separate passes; a dangling reference
    must not abort the whole atlas build."""
    nodes = _nodes(2)
    edges = [(nodes[0]["id"], "does-not-exist", 0.9), (nodes[0]["id"], nodes[1]["id"], 0.5)]
    payload = build_atlas_payload(nodes, edges, [])
    assert payload["edge_count"] == 1


def test_self_edges_dropped():
    nodes = _nodes(1)
    payload = build_atlas_payload(nodes, [(nodes[0]["id"], nodes[0]["id"], 1.0)], [])
    assert payload["edge_count"] == 0


def test_duplicate_nodes_collapse():
    nodes = _nodes(2) + _nodes(1)
    payload = build_atlas_payload(nodes, [], [])
    assert payload["node_count"] == 2


def test_etag_is_stable_for_identical_content():
    """Determinism matters: an unchanged atlas must keep its ETag so clients
    keep getting 304 instead of re-downloading."""
    payload = build_atlas_payload(_nodes(20), [], [], computed_at="2026-01-01T00:00:00Z")
    assert encode_atlas(payload)[1] == encode_atlas(payload)[1]


def test_etag_changes_when_content_changes():
    a = build_atlas_payload(_nodes(20), [], [], computed_at="2026-01-01T00:00:00Z")
    b = build_atlas_payload(_nodes(21), [], [], computed_at="2026-01-01T00:00:00Z")
    assert encode_atlas(a)[1] != encode_atlas(b)[1]


def test_missing_coordinates_do_not_crash():
    node = {"id": "x", "title": "t", "x": None, "y": None}
    payload = build_atlas_payload([node], [], [])
    assert payload["nodes"]["x"] == [0.0]


def test_whole_corpus_payload_stays_wire_viable():
    """The point of the columnar+gzip encoding. 25k grants at ~4 edges each is a
    realistic full-corpus atlas; it has to fit in a response a browser will
    actually accept."""
    n = 25_000
    nodes = _nodes(n)
    ids = [x["id"] for x in nodes]
    edges = [(ids[i % n], ids[(i * 7 + 13) % n], 0.5 + (i % 50) / 100) for i in range(n * 4)]

    payload = build_atlas_payload(nodes, edges, [{"id": i, "label": f"C{i}", "color": "#fff"} for i in range(12)])
    blob, _etag = encode_atlas(payload)

    assert payload["node_count"] == n
    assert payload["edge_count"] > n * 3
    size_mb = len(blob) / 1_048_576
    assert size_mb < 12, f"atlas is {size_mb:.1f} MB gzipped — too large to ship"
    print(f"\n25k-node atlas: {size_mb:.2f} MB gzipped, {payload['edge_count']} edges")
