"""Serialization for the precomputed grant atlas.

The atlas is the whole corpus as one graph: every embedded opportunity, its
Leiden community, its UMAP position, and the kNN edges between them. It is
**identical for every user**, so it is computed once by the clustering task,
stored, and served byte-for-byte to everyone with an ETag. Nothing here is
per-request or per-institution.

Two encoding decisions keep a full-corpus payload tractable:

  * **Columnar, not array-of-objects.** Repeating twelve JSON keys per node
    costs more than the data. Parallel arrays let gzip collapse the structure
    and cut the payload several-fold.
  * **Index-based edges.** An edge as {"source": <36-char uuid>, "target":
    <36-char uuid>} is ~90 bytes; as a pair of integer offsets into the node
    arrays it is ~12. At four edges per node that difference dominates the
    response.

Per-institution fit scores deliberately do *not* live here — they differ per
org, and folding them in would make the artifact unshareable. The atlas carries
the global score; org-specific scores ride along as a small separate overlay.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from typing import Any, Iterable, Sequence

ATLAS_FORMAT_VERSION = 2


def build_atlas_payload(
    nodes: Sequence[dict[str, Any]],
    edges: Iterable[tuple[str, str, float]],
    clusters: Sequence[dict[str, Any]],
    *,
    computed_at: str | None = None,
) -> dict[str, Any]:
    """Build the columnar atlas document.

    `nodes` items need: id, title, funder, deadline, fit_score, cluster_id,
    theme, x, y. `edges` are (source_id, target_id, weight) using node ids;
    edges referencing an unknown node are dropped rather than raising, since the
    node set and edge set are produced by separate passes.
    """
    index_of: dict[str, int] = {}
    ids: list[str] = []
    titles: list[str] = []
    funders: list[str | None] = []
    deadlines: list[str | None] = []
    fits: list[int | None] = []
    cluster_ids: list[int | None] = []
    themes: list[str | None] = []
    xs: list[float] = []
    ys: list[float] = []

    for node in nodes:
        nid = node["id"]
        if nid in index_of:
            continue
        index_of[nid] = len(ids)
        ids.append(nid)
        titles.append(node.get("title") or "")
        funders.append(node.get("funder"))
        deadlines.append(node.get("deadline"))
        fit = node.get("fit_score")
        fits.append(int(fit) if fit is not None else None)
        cluster_ids.append(node.get("cluster_id"))
        themes.append(node.get("theme"))
        # Coordinates are pre-normalised to [0,1]; 4 decimals is ~1/10000 of the
        # canvas, far below one pixel, and shortens every number in the payload.
        xs.append(round(float(node.get("x") or 0.0), 4))
        ys.append(round(float(node.get("y") or 0.0), 4))

    src: list[int] = []
    tgt: list[int] = []
    weights: list[float] = []
    for a, b, w in edges:
        ia = index_of.get(a)
        ib = index_of.get(b)
        if ia is None or ib is None or ia == ib:
            continue
        src.append(ia)
        tgt.append(ib)
        weights.append(round(float(w), 3))

    return {
        "v": ATLAS_FORMAT_VERSION,
        "computed_at": computed_at,
        "clusters": [
            {"id": c["id"], "label": c.get("label") or "", "color": c.get("color")}
            for c in clusters
        ],
        "nodes": {
            "id": ids,
            "title": titles,
            "funder": funders,
            "deadline": deadlines,
            "fit": fits,
            "cluster": cluster_ids,
            "theme": themes,
            "x": xs,
            "y": ys,
        },
        "edges": {"s": src, "t": tgt, "w": weights},
        "node_count": len(ids),
        "edge_count": len(src),
    }


def encode_atlas(payload: dict[str, Any]) -> tuple[bytes, str]:
    """Gzip the atlas and return (bytes, etag).

    Stored gzipped and served with Content-Encoding: gzip, so the bytes on disk
    are the bytes on the wire — no per-request compression for an artifact that
    never varies between users. mtime=0 keeps the output deterministic so an
    unchanged atlas keeps its ETag.
    """
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    blob = gzip.compress(raw, compresslevel=6, mtime=0)
    etag = hashlib.sha256(blob).hexdigest()[:32]
    return blob, etag


def decode_atlas(blob: bytes) -> dict[str, Any]:
    """Inverse of `encode_atlas` — used by tests and any server-side reader."""
    return json.loads(gzip.decompress(blob).decode("utf-8"))
