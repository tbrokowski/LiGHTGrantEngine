'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import ColorModeSelector, { ColorMode } from './ColorModeSelector';

// Dynamically import ForceGraph2D to avoid SSR issues (canvas API)
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  fit_score: number | null;
  priority: string | null;
  cluster_id: number | null;
  thematic_areas: string[];
  geography: string[];
  ai_summary: string | null;
  status: string;
  umap_x: number | null;
  umap_y: number | null;
}

export interface GraphCluster {
  id: number;
  label: string;
  color: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

// Internal node type used by react-force-graph-2d (extends GraphNode with layout fields)
interface FGNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  index?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#3b82f6', '#22c55e', '#fbbf24',
];

// Categorical palette for thematic area coloring
const THEME_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#3b82f6', '#22c55e', '#fbbf24',
  '#64748b', '#d946ef', '#0891b2', '#65a30d', '#b45309',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

/** Map fit_score [0, 100] → a hex color (blue → green gradient). */
function fitScoreColor(score: number | null): string {
  const s = score ?? 50;
  const t = Math.max(0, Math.min(1, s / 100));
  // Interpolate: low → #60a5fa (blue-400), high → #10b981 (emerald-500)
  const r = Math.round(96 + (16 - 96) * t);
  const g = Math.round(165 + (185 - 165) * t);
  const b = Math.round(250 + (129 - 250) * t);
  return `rgb(${r},${g},${b})`;
}

/** Map deadline urgency → color. */
function deadlineColor(deadline: string | null): string {
  const days = daysUntil(deadline);
  if (days === null) return '#9ca3af'; // gray-400: no deadline
  if (days < 0)      return '#9ca3af'; // gray:    past
  if (days <= 14)    return '#ef4444'; // red-500: < 2 weeks
  if (days <= 30)    return '#f97316'; // orange-500: < 1 month
  if (days <= 60)    return '#f59e0b'; // amber-500: < 2 months
  return '#10b981';                    // emerald-500: plenty of time
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  nodes: GraphNode[];
  clusters: GraphCluster[];
  edges: GraphEdge[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OpportunityGraphView({ nodes, clusters, edges }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 560 });
  const [colorMode, setColorMode] = useState<ColorMode>('community');
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height: Math.max(400, height) });
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Derived color maps ────────────────────────────────────────────────────

  const clusterColorMap = useMemo(() => {
    const m = new Map<number, string>();
    clusters.forEach((c, i) => {
      m.set(c.id, c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
    });
    return m;
  }, [clusters]);

  const themeColorMap = useMemo(() => {
    const allThemes = [...new Set(nodes.flatMap(n => n.thematic_areas))].sort();
    const m = new Map<string, string>();
    allThemes.forEach((t, i) => {
      m.set(t, THEME_COLORS[i % THEME_COLORS.length]);
    });
    return m;
  }, [nodes]);

  const getNodeColor = useCallback((rawNode: unknown): string => {
    const node = rawNode as FGNode;
    switch (colorMode) {
      case 'community':
        if (node.cluster_id !== null && clusterColorMap.has(node.cluster_id)) {
          return clusterColorMap.get(node.cluster_id)!;
        }
        return DEFAULT_COLORS[(node.index ?? 0) % DEFAULT_COLORS.length];
      case 'thematic': {
        const theme = node.thematic_areas?.[0];
        if (theme && themeColorMap.has(theme)) return themeColorMap.get(theme)!;
        return '#9ca3af';
      }
      case 'fit_score':
        return fitScoreColor(node.fit_score);
      case 'deadline':
        return deadlineColor(node.deadline);
    }
  }, [colorMode, clusterColorMap, themeColorMap]);

  const getNodeVal = useCallback((rawNode: unknown): number => {
    const node = rawNode as FGNode;
    const score = node.fit_score ?? 50;
    // Map [0, 100] → [4, 20] for node size
    return Math.max(4, Math.min(20, 4 + score / 5));
  }, []);

  // ── Graph data ────────────────────────────────────────────────────────────

  const graphData = useMemo(() => {
    // Scale UMAP [0,1] coordinates to canvas space, centered and padded
    const padding = 80;
    const usableW = dimensions.width - padding * 2;
    const usableH = dimensions.height - padding * 2;

    const fgNodes: FGNode[] = nodes.map(n => {
      const base: FGNode = { ...n };
      if (n.umap_x !== null && n.umap_y !== null) {
        base.x = padding + n.umap_x * usableW;
        base.y = padding + n.umap_y * usableH;
      }
      return base;
    });

    // react-force-graph-2d uses "links" (not "edges") and resolves
    // source/target by node id — pass through as-is.
    const links = edges.map(e => ({ ...e }));

    return { nodes: fgNodes, links };
  }, [nodes, edges, dimensions]);

  // ── Edge rendering ────────────────────────────────────────────────────────

  const getLinkColor = useCallback(
    (rawLink: unknown) => {
      const link = rawLink as { source: string | FGNode; target: string | FGNode; weight: number };
      // Semi-transparent gray; more opaque for stronger edges
      const alpha = Math.round(Math.max(0.05, Math.min(0.35, link.weight * 0.4)) * 255)
        .toString(16).padStart(2, '0');
      return `#94a3b8${alpha}`;
    },
    [],
  );

  const getLinkWidth = useCallback(
    (rawLink: unknown) => {
      const link = rawLink as { weight: number };
      return Math.max(0.5, link.weight * 2.5);
    },
    [],
  );

  // ── Legend ────────────────────────────────────────────────────────────────

  const legendItems = useMemo(() => {
    switch (colorMode) {
      case 'community':
        return clusters.map((c, i) => ({
          color: c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          label: c.label,
        }));
      case 'thematic': {
        const items: { color: string; label: string }[] = [];
        themeColorMap.forEach((color, theme) => {
          items.push({ color, label: theme });
        });
        return items.slice(0, 15);
      }
      case 'fit_score':
        return [
          { color: fitScoreColor(90), label: 'High fit (≥ 70)' },
          { color: fitScoreColor(50), label: 'Medium fit (40–70)' },
          { color: fitScoreColor(20), label: 'Low fit (< 40)' },
        ];
      case 'deadline':
        return [
          { color: '#10b981', label: '> 60 days' },
          { color: '#f59e0b', label: '30–60 days' },
          { color: '#f97316', label: '14–30 days' },
          { color: '#ef4444', label: '< 14 days' },
          { color: '#9ca3af', label: 'No deadline' },
        ];
    }
  }, [colorMode, clusters, themeColorMap]);

  // ── Tooltip mouse tracking ─────────────────────────────────────────────────

  function handleContainerMouseMove(e: React.MouseEvent) {
    setMousePos({ x: e.clientX, y: e.clientY });
  }

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-gray-400">No opportunities to display.</p>
          <p className="text-xs text-gray-300 mt-1">
            Opportunities will appear here once they are discovered and clustered.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 w-full h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white shrink-0">
        <ColorModeSelector value={colorMode} onChange={setColorMode} />
        <span className="text-xs text-gray-400">
          {nodes.length} grants · {edges.length} connections
        </span>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full bg-gray-50"
        onMouseMove={handleContainerMouseMove}
        style={{ minHeight: 400 }}
      >
        <ForceGraph2D
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#f9fafb"
          nodeId="id"
          nodeVal={getNodeVal}
          nodeColor={getNodeColor}
          nodeLabel=""
          linkSource="source"
          linkTarget="target"
          linkColor={getLinkColor}
          linkWidth={getLinkWidth}
          linkCurvature={0.1}
          onNodeHover={(node) => setHoveredNode(node as FGNode | null)}
          onNodeClick={(node) => router.push(`/opportunities/${(node as FGNode).id}`)}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={60}
          cooldownTime={3000}
        />

        {/* Cluster legend */}
        {legendItems.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-3 py-2 text-xs space-y-1 max-h-48 overflow-y-auto shadow-sm">
            {legendItems.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-gray-600 truncate max-w-[160px]">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 max-w-[280px] pointer-events-none"
            style={{ left: mousePos.x + 14, top: mousePos.y - 10 }}
          >
            <p className="text-xs font-semibold text-gray-900 leading-snug mb-1.5">
              {hoveredNode.title}
            </p>
            {hoveredNode.funder && (
              <p className="text-xs text-gray-500 mb-1">{hoveredNode.funder}</p>
            )}
            {hoveredNode.thematic_areas?.length > 0 && (
              <p className="text-xs text-indigo-600 mb-1 truncate">
                {hoveredNode.thematic_areas.slice(0, 2).join(' · ')}
              </p>
            )}
            {hoveredNode.deadline && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: deadlineColor(hoveredNode.deadline) }}
                />
                <span className="text-xs text-gray-500">
                  {formatDate(hoveredNode.deadline)}
                  {daysUntil(hoveredNode.deadline) !== null &&
                    (daysUntil(hoveredNode.deadline)! > 0
                      ? ` · ${daysUntil(hoveredNode.deadline)} days`
                      : ' · past deadline')}
                </span>
              </div>
            )}
            {hoveredNode.priority && (
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: fitScoreColor(hoveredNode.fit_score) + '22',
                  color: fitScoreColor(hoveredNode.fit_score),
                }}
              >
                {hoveredNode.priority === 'high' || hoveredNode.priority === 'high_priority'
                  ? 'High Fit'
                  : hoveredNode.priority === 'medium' || hoveredNode.priority === 'worth_reviewing'
                  ? 'Medium Fit'
                  : 'Low Fit'}
              </span>
            )}
            {hoveredNode.ai_summary && (
              <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">
                {hoveredNode.ai_summary}
              </p>
            )}
            <p className="text-xs text-gray-300 mt-2">Click to open</p>
          </div>
        )}
      </div>
    </div>
  );
}
