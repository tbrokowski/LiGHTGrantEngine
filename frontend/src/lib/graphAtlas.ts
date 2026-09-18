/**
 * Decoder for the precomputed whole-corpus grant atlas.
 *
 * The backend serves one gzipped, columnar artifact that is identical for every
 * user — built once per clustering run, not assembled per request. Columnar
 * arrays plus index-encoded edges keep a 25k-node / 100k-edge graph around
 * 0.6 MB on the wire; an array-of-objects encoding with uuid edge endpoints is
 * several times that.
 *
 * Per-institution fit scores arrive separately (`graphOverlay`) and are merged
 * in here, so the atlas itself stays shareable.
 */
import type { GraphNode, GraphCluster, GraphEdge } from '@/components/opportunities/OpportunityGraphView';

export interface AtlasPayload {
  v: number;
  computed_at: string | null;
  clusters: { id: number; label: string; color: string | null }[];
  nodes: {
    id: string[];
    title: string[];
    funder: (string | null)[];
    deadline: (string | null)[];
    fit: (number | null)[];
    cluster: (number | null)[];
    theme: (string | null)[];
    x: number[];
    y: number[];
  };
  edges: { s: number[]; t: number[]; w: number[] };
  node_count: number;
  edge_count: number;
}

export interface DecodedAtlas {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  computedAt: string | null;
}

export function decodeAtlas(
  payload: AtlasPayload,
  overlayScores?: Record<string, number>,
): DecodedAtlas {
  const n = payload.nodes?.id?.length ?? 0;
  const cols = payload.nodes;

  const nodes: GraphNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = cols.id[i];
    const theme = cols.theme?.[i] ?? null;
    nodes[i] = {
      id,
      title: cols.title[i] ?? '',
      funder: cols.funder?.[i] ?? null,
      deadline: cols.deadline?.[i] ?? null,
      // Prefer this org's score when the overlay has one; the atlas carries the
      // global score so the artifact stays identical for every user.
      fit_score: overlayScores?.[id] ?? cols.fit?.[i] ?? null,
      priority: null,
      cluster_id: cols.cluster?.[i] ?? null,
      thematic_areas: theme ? [theme] : [],
      geography: [],
      ai_summary: null,
      status: '',
      umap_x: cols.x?.[i] ?? null,
      umap_y: cols.y?.[i] ?? null,
    };
  }

  const es = payload.edges?.s ?? [];
  const et = payload.edges?.t ?? [];
  const ew = payload.edges?.w ?? [];
  const edges: GraphEdge[] = new Array(es.length);
  for (let i = 0; i < es.length; i++) {
    edges[i] = { source: cols.id[es[i]], target: cols.id[et[i]], weight: ew[i] ?? 0 };
  }

  return {
    nodes,
    edges,
    clusters: (payload.clusters ?? []).map(c => ({ id: c.id, label: c.label, color: c.color })),
    computedAt: payload.computed_at ?? null,
  };
}
