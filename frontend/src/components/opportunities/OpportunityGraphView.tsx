'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export interface GraphNode {
  id: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  fit_score: number | null;
  cluster_id: number | null;
  thematic_areas: string[];
  ai_summary: string | null;
  status: string;
}

export interface GraphCluster {
  id: number;
  label: string;
  color: string | null;
}

interface TooltipState {
  node: GraphNode;
  x: number;
  y: number;
}

const DEFAULT_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899',
];

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return d; }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

interface Props {
  nodes: GraphNode[];
  clusters: GraphCluster[];
}

export default function OpportunityGraphView({ nodes, clusters }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const animFrameRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragNodeRef = useRef<string | null>(null);
  const velocitiesRef = useRef<Map<string, { vx: number; vy: number }>>(new Map());

  const clusterColorMap = new Map<number, string>();
  clusters.forEach((c, i) => {
    clusterColorMap.set(c.id, c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
  });

  function getNodeColor(node: GraphNode): string {
    if (node.cluster_id !== null && clusterColorMap.has(node.cluster_id)) {
      return clusterColorMap.get(node.cluster_id)!;
    }
    const i = nodes.indexOf(node) % DEFAULT_COLORS.length;
    return DEFAULT_COLORS[i];
  }

  function getNodeRadius(node: GraphNode): number {
    const score = node.fit_score ?? 50;
    return Math.max(5, Math.min(16, 5 + score / 10));
  }

  // Initialize positions in clusters
  useEffect(() => {
    if (nodes.length === 0) return;
    const positions = new Map<string, { x: number; y: number }>();
    const velocities = new Map<string, { vx: number; vy: number }>();

    const clusterGroups = new Map<number | null, GraphNode[]>();
    nodes.forEach(n => {
      const cid = n.cluster_id;
      if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
      clusterGroups.get(cid)!.push(n);
    });

    const clusterCount = clusterGroups.size;
    let clusterIdx = 0;
    const { width, height } = dimensions;

    clusterGroups.forEach((group) => {
      const angle = (clusterIdx / clusterCount) * Math.PI * 2;
      const cx = width / 2 + Math.cos(angle) * (Math.min(width, height) * 0.3);
      const cy = height / 2 + Math.sin(angle) * (Math.min(width, height) * 0.3);

      group.forEach((node, i) => {
        const spread = Math.min(80, 20 + group.length * 2);
        const a2 = (i / Math.max(group.length, 1)) * Math.PI * 2;
        positions.set(node.id, {
          x: cx + Math.cos(a2) * spread * (0.5 + Math.random() * 0.5),
          y: cy + Math.sin(a2) * spread * (0.5 + Math.random() * 0.5),
        });
        velocities.set(node.id, { vx: 0, vy: 0 });
      });
      clusterIdx++;
    });

    positionsRef.current = positions;
    velocitiesRef.current = velocities;
  }, [nodes, dimensions]);

  // Force simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    function tick() {
      const positions = positionsRef.current;
      const velocities = velocitiesRef.current;
      const { width, height } = dimensions;

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = positions.get(nodes[i].id);
          const b = positions.get(nodes[j].id);
          if (!a || !b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 400 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const va = velocities.get(nodes[i].id)!;
          const vb = velocities.get(nodes[j].id)!;
          va.vx += fx; va.vy += fy;
          vb.vx -= fx; vb.vy -= fy;
        }
      }

      // Cluster attraction
      const clusterCentroids = new Map<number | null, { x: number; y: number; count: number }>();
      nodes.forEach(n => {
        const p = positions.get(n.id);
        if (!p) return;
        const c = n.cluster_id;
        if (!clusterCentroids.has(c)) clusterCentroids.set(c, { x: 0, y: 0, count: 0 });
        const cc = clusterCentroids.get(c)!;
        cc.x += p.x; cc.y += p.y; cc.count++;
      });
      clusterCentroids.forEach((cc, cid) => {
        if (cc.count === 0) return;
        cc.x /= cc.count; cc.y /= cc.count;
        nodes.forEach(n => {
          if (n.cluster_id !== cid) return;
          const p = positions.get(n.id);
          const v = velocities.get(n.id);
          if (!p || !v) return;
          const dx = cc.x - p.x;
          const dy = cc.y - p.y;
          v.vx += dx * 0.01;
          v.vy += dy * 0.01;
        });
      });

      // Center gravity
      nodes.forEach(n => {
        const p = positions.get(n.id);
        const v = velocities.get(n.id);
        if (!p || !v) return;
        v.vx += (width / 2 - p.x) * 0.001;
        v.vy += (height / 2 - p.y) * 0.001;
      });

      // Apply velocities with damping
      nodes.forEach(n => {
        if (dragNodeRef.current === n.id) return;
        const p = positions.get(n.id);
        const v = velocities.get(n.id);
        if (!p || !v) return;
        v.vx *= 0.8; v.vy *= 0.8;
        p.x = Math.max(20, Math.min(width - 20, p.x + v.vx));
        p.y = Math.max(20, Math.min(height - 20, p.y + v.vy));
      });

      draw();
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, clusters, dimensions]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = dimensions;
    ctx.clearRect(0, 0, width, height);

    const positions = positionsRef.current;

    // Draw edges (same cluster)
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < Math.min(nodes.length, 50); i++) {
      for (let j = i + 1; j < Math.min(nodes.length, 50); j++) {
        if (nodes[i].cluster_id !== null && nodes[i].cluster_id === nodes[j].cluster_id) {
          const a = positions.get(nodes[i].id);
          const b = positions.get(nodes[j].id);
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.strokeStyle = getNodeColor(nodes[i]);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw nodes
    nodes.forEach(node => {
      const p = positions.get(node.id);
      if (!p) return;
      const r = getNodeRadius(node);
      const color = getNodeColor(node);

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function getNodeAt(x: number, y: number): GraphNode | null {
    const positions = positionsRef.current;
    for (const node of nodes) {
      const p = positions.get(node.id);
      if (!p) continue;
      const r = getNodeRadius(node) + 4;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r * r) return node;
    }
    return null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDraggingRef.current && dragNodeRef.current) {
      positionsRef.current.set(dragNodeRef.current, { x, y });
      return;
    }

    const node = getNodeAt(x, y);
    if (node) {
      setTooltip({ node, x: e.clientX, y: e.clientY });
    } else {
      setTooltip(null);
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = getNodeAt(x, y);
    if (node) {
      isDraggingRef.current = true;
      dragNodeRef.current = node.id;
    }
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDraggingRef.current) {
      // it's a click
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const node = getNodeAt(x, y);
      if (node) {
        router.push(`/opportunities/${node.id}`);
      }
    }
    isDraggingRef.current = false;
    dragNodeRef.current = null;
  }

  function handleMouseLeave() {
    setTooltip(null);
    isDraggingRef.current = false;
    dragNodeRef.current = null;
  }

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

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-gray-400">No opportunities to display.</p>
          <p className="text-xs text-gray-300 mt-1">Opportunities will appear here once they are discovered and clustered.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 w-full" style={{ minHeight: 500 }}>
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: tooltip ? 'pointer' : 'default' }}
        className="w-full h-full"
      />

      {/* Cluster legend */}
      {clusters.length > 0 && (
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-3 py-2 text-xs space-y-1 max-h-48 overflow-y-auto shadow-sm">
          {clusters.map((c, i) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}
              />
              <span className="text-gray-600 truncate max-w-[140px]">{c.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 max-w-[280px] pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <p className="text-xs font-semibold text-gray-900 leading-snug mb-1.5">{tooltip.node.title}</p>
          {tooltip.node.funder && (
            <p className="text-xs text-gray-500 mb-1">{tooltip.node.funder}</p>
          )}
          {tooltip.node.deadline && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${(daysUntil(tooltip.node.deadline) ?? 999) <= 14 ? 'bg-red-400' : 'bg-gray-300'}`} />
              <span className="text-xs text-gray-500">{formatDate(tooltip.node.deadline)}</span>
            </div>
          )}
          {tooltip.node.fit_score !== null && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${tooltip.node.fit_score >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
              Score {tooltip.node.fit_score}
            </span>
          )}
          {tooltip.node.ai_summary && (
            <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{tooltip.node.ai_summary}</p>
          )}
        </div>
      )}
    </div>
  );
}
