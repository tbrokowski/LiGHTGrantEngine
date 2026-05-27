'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ArchiveGraphNode {
  id: string;
  title: string;
  funder: string | null;
  outcome: string | null;
  call_year: number | null;
  lead_pi: string | null;
  requested_amount: number | null;
  awarded_amount: number | null;
  currency: string | null;
  themes: string[];
  geographies: string[];
  cluster_id: number | null;
  umap_x: number | null;
  umap_y: number | null;
}

export interface ArchiveGraphCluster {
  id: number;
  label: string;
  color: string | null;
}

export interface ArchiveGraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface FGNode extends ArchiveGraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  index?: number;
}

// ── Color maps ─────────────────────────────────────────────────────────────────

export type ArchiveColorMode = 'cluster' | 'outcome' | 'funder' | 'year';

const DEFAULT_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#3b82f6', '#22c55e', '#fbbf24',
];

const OUTCOME_COLORS: Record<string, string> = {
  awarded:          '#10b981', // emerald-500
  partially_funded: '#0ea5e9', // sky-500
  pending:          '#f59e0b', // amber-500
  resubmitted:      '#8b5cf6', // violet-500
  deferred:         '#06b6d4', // cyan-500
  not_submitted:    '#94a3b8', // slate-400
  withdrawn:        '#9ca3af', // gray-400
  rejected:         '#ef4444', // red-500
};

const YEAR_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#a855f7',
];

/** Deterministic hash-to-color for arbitrary funder strings. */
function funderColor(funder: string | null): string {
  if (!funder) return '#9ca3af';
  let h = 0;
  for (let i = 0; i < funder.length; i++) {
    h = (h * 31 + funder.charCodeAt(i)) >>> 0;
  }
  return DEFAULT_COLORS[h % DEFAULT_COLORS.length];
}

function formatAmount(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null;
  const fmt = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumSignificantDigits: 3,
  }).format(amount);
  return currency ? `${currency} ${fmt}` : fmt;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  nodes: ArchiveGraphNode[];
  clusters: ArchiveGraphCluster[];
  edges: ArchiveGraphEdge[];
}

// ── Color mode selector ────────────────────────────────────────────────────────

const COLOR_MODE_OPTIONS: { value: ArchiveColorMode; label: string }[] = [
  { value: 'cluster',  label: 'Topic cluster' },
  { value: 'outcome',  label: 'Outcome' },
  { value: 'funder',   label: 'Funder' },
  { value: 'year',     label: 'Year' },
];

function ArchiveColorModeSelector({
  value,
  onChange,
}: {
  value: ArchiveColorMode;
  onChange: (m: ArchiveColorMode) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-400 mr-0.5">Color by</span>
      {COLOR_MODE_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
            value === opt.value
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ArchiveGraphView({ nodes, clusters, edges }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 560 });
  const [colorMode, setColorMode] = useState<ArchiveColorMode>('cluster');
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

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

  // ── Derived color maps ───────────────────────────────────────────────────────

  const clusterColorMap = useMemo(() => {
    const m = new Map<number, string>();
    clusters.forEach((c, i) => {
      m.set(c.id, c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
    });
    return m;
  }, [clusters]);

  const yearColorMap = useMemo(() => {
    const years = [...new Set(nodes.map(n => n.call_year).filter(Boolean) as number[])].sort();
    const m = new Map<number, string>();
    years.forEach((y, i) => m.set(y, YEAR_COLORS[i % YEAR_COLORS.length]));
    return m;
  }, [nodes]);

  const getNodeColor = useCallback(
    (rawNode: unknown): string => {
      const node = rawNode as FGNode;
      switch (colorMode) {
        case 'cluster':
          if (node.cluster_id !== null && clusterColorMap.has(node.cluster_id)) {
            return clusterColorMap.get(node.cluster_id)!;
          }
          return DEFAULT_COLORS[(node.index ?? 0) % DEFAULT_COLORS.length];
        case 'outcome':
          return OUTCOME_COLORS[node.outcome ?? ''] ?? '#94a3b8';
        case 'funder':
          return funderColor(node.funder);
        case 'year':
          if (node.call_year && yearColorMap.has(node.call_year)) {
            return yearColorMap.get(node.call_year)!;
          }
          return '#9ca3af';
      }
    },
    [colorMode, clusterColorMap, yearColorMap],
  );

  // Uniform node size; optionally scale by requested_amount
  const getNodeVal = useCallback((rawNode: unknown): number => {
    const node = rawNode as FGNode;
    if (node.requested_amount != null && node.requested_amount > 0) {
      // Map log-scale amounts to [4, 14]
      const log = Math.log10(node.requested_amount);
      return Math.max(4, Math.min(14, log * 1.4));
    }
    return 6;
  }, []);

  // ── Graph data ───────────────────────────────────────────────────────────────

  const graphData = useMemo(() => {
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

    return { nodes: fgNodes, links: edges.map(e => ({ ...e })) };
  }, [nodes, edges, dimensions]);

  // ── Edge rendering ───────────────────────────────────────────────────────────

  const getLinkColor = useCallback((rawLink: unknown) => {
    const link = rawLink as { weight: number };
    const alpha = Math.round(Math.max(0.05, Math.min(0.35, link.weight * 0.4)) * 255)
      .toString(16)
      .padStart(2, '0');
    return `#94a3b8${alpha}`;
  }, []);

  const getLinkWidth = useCallback(
    (rawLink: unknown) => Math.max(0.5, (rawLink as { weight: number }).weight * 2.5),
    [],
  );

  // ── Legend ───────────────────────────────────────────────────────────────────

  const legendItems = useMemo(() => {
    switch (colorMode) {
      case 'cluster':
        return clusters.map((c, i) => ({
          color: c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          label: c.label,
        }));
      case 'outcome':
        return Object.entries(OUTCOME_COLORS).map(([k, color]) => ({
          color,
          label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        }));
      case 'funder': {
        const seen = new Map<string, string>();
        nodes.forEach(n => {
          if (n.funder && !seen.has(n.funder)) {
            seen.set(n.funder, funderColor(n.funder));
          }
        });
        return [...seen.entries()].slice(0, 15).map(([label, color]) => ({ label, color }));
      }
      case 'year': {
        const items: { color: string; label: string }[] = [];
        yearColorMap.forEach((color, year) => items.push({ color, label: String(year) }));
        return items.sort((a, b) => Number(b.label) - Number(a.label));
      }
    }
  }, [colorMode, clusters, nodes, yearColorMap]);

  function handleContainerMouseMove(e: React.MouseEvent) {
    setMousePos({ x: e.clientX, y: e.clientY });
  }

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600 mb-1">No clustered archives yet</p>
          <p className="text-xs text-gray-400">
            Clustering runs automatically 5 minutes after each archive is indexed, or every 6 hours.
            Upload and index a few proposals to see the graph.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 w-full h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white shrink-0">
        <ArchiveColorModeSelector value={colorMode} onChange={setColorMode} />
        <span className="text-xs text-gray-400">
          {nodes.length} proposals · {edges.length} connections
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
          onNodeHover={node => setHoveredNode(node as FGNode | null)}
          onNodeClick={node => router.push(`/archive/${(node as FGNode).id}`)}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={60}
          cooldownTime={3000}
        />

        {/* Legend */}
        {legendItems.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-3 py-2 text-xs space-y-1 max-h-52 overflow-y-auto shadow-sm">
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
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {hoveredNode.outcome && (
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: (OUTCOME_COLORS[hoveredNode.outcome] ?? '#94a3b8') + '22',
                    color: OUTCOME_COLORS[hoveredNode.outcome] ?? '#94a3b8',
                  }}
                >
                  {hoveredNode.outcome.replace(/_/g, ' ')}
                </span>
              )}
              {hoveredNode.call_year && (
                <span className="text-xs text-gray-400">{hoveredNode.call_year}</span>
              )}
            </div>
            {hoveredNode.lead_pi && (
              <p className="text-xs text-gray-400 mb-1">PI: {hoveredNode.lead_pi}</p>
            )}
            {(hoveredNode.requested_amount != null || hoveredNode.awarded_amount != null) && (
              <p className="text-xs text-gray-400 mb-1">
                {hoveredNode.awarded_amount != null
                  ? `Awarded: ${formatAmount(hoveredNode.awarded_amount, hoveredNode.currency)}`
                  : `Requested: ${formatAmount(hoveredNode.requested_amount, hoveredNode.currency)}`}
              </p>
            )}
            {hoveredNode.themes?.length > 0 && (
              <p className="text-xs text-indigo-600 truncate">
                {hoveredNode.themes.slice(0, 2).join(' · ')}
              </p>
            )}
            <p className="text-xs text-gray-300 mt-2">Click to open</p>
          </div>
        )}
      </div>
    </div>
  );
}
