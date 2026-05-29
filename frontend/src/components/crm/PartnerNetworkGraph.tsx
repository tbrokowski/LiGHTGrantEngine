'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const STAGE_COLORS: Record<string, string> = {
  prospect: '#9ca3af',
  qualified: '#60a5fa',
  engaged: '#818cf8',
  collaborating: '#34d399',
  alumni: '#fbbf24',
};

interface Partner {
  id: string;
  name: string;
  organization?: string;
  relationship_stage: string;
  tags: string[];
  grant_links_count?: number;
}

interface PartnerNetworkGraphProps {
  partners: Partner[];
}

export default function PartnerNetworkGraph({ partners }: PartnerNetworkGraphProps) {
  const [selectedNode, setSelectedNode] = useState<Partner | null>(null);
  const graphRef = useRef<any>(null);

  if (typeof window === 'undefined') return null;

  // Build graph data
  const nodes = partners.map(p => ({
    id: p.id,
    name: p.name,
    organization: p.organization || '',
    stage: p.relationship_stage,
    tags: p.tags,
    color: STAGE_COLORS[p.relationship_stage] || '#9ca3af',
    val: (p.grant_links_count || 0) + 2,
  }));

  // Create edges between partners sharing the same organization
  const orgGroups: Record<string, string[]> = {};
  partners.forEach(p => {
    if (p.organization) {
      if (!orgGroups[p.organization]) orgGroups[p.organization] = [];
      orgGroups[p.organization].push(p.id);
    }
  });

  const links: { source: string; target: string; label: string }[] = [];
  Object.entries(orgGroups).forEach(([org, ids]) => {
    for (let i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        links.push({ source: ids[i], target: ids[j], label: org });
      }
    }
  });

  // Tag-based edges (shared tags)
  const tagGroups: Record<string, string[]> = {};
  partners.forEach(p => {
    p.tags.forEach(tag => {
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(p.id);
    });
  });
  Object.entries(tagGroups).forEach(([tag, ids]) => {
    if (ids.length > 1 && ids.length <= 8) {
      for (let i = 0; i < ids.length - 1; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          // Avoid duplicates
          const existingLink = links.find(
            l => (l.source === ids[i] && l.target === ids[j]) ||
                 (l.source === ids[j] && l.target === ids[i])
          );
          if (!existingLink) {
            links.push({ source: ids[i], target: ids[j], label: tag });
          }
        }
      }
    }
  });

  return (
    <div className="relative bg-gray-950 rounded-xl overflow-hidden" style={{ height: 520 }}>
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 bg-black/60 backdrop-blur rounded-lg px-3 py-2">
        <p className="text-xs text-gray-400 mb-1.5 font-medium">Stages</p>
        {Object.entries(STAGE_COLORS).map(([stage, color]) => (
          <div key={stage} className="flex items-center gap-2 text-xs text-gray-300 mb-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            {stage.charAt(0).toUpperCase() + stage.slice(1)}
          </div>
        ))}
        <p className="text-xs text-gray-500 mt-1.5">Lines = shared org/expertise</p>
      </div>

      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute top-3 right-3 z-10 bg-black/70 backdrop-blur rounded-lg px-3 py-2 max-w-[200px]">
          <p className="text-sm font-semibold text-white truncate">{selectedNode.name}</p>
          {selectedNode.organization && (
            <p className="text-xs text-gray-400 truncate">{selectedNode.organization}</p>
          )}
          <Link href={`/partners/${selectedNode.id}`}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1 block">
            View profile →
          </Link>
        </div>
      )}

      {partners.length < 2 ? (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
          Add at least 2 partners to see the network graph.
        </div>
      ) : (
        <ForceGraph2D
          ref={graphRef}
          graphData={{ nodes, links }}
          nodeLabel="name"
          nodeColor="color"
          nodeVal="val"
          nodeRelSize={5}
          linkColor={() => 'rgba(255,255,255,0.15)'}
          linkWidth={1}
          backgroundColor="#030712"
          onNodeClick={(node: any) => {
            setSelectedNode({
              id: node.id,
              name: node.name,
              organization: node.organization,
              relationship_stage: node.stage,
              tags: node.tags,
            });
          }}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.name as string;
            const fontSize = Math.max(10 / globalScale, 8);
            const r = Math.sqrt((node.val as number)) * 3;
            ctx.beginPath();
            ctx.arc(node.x as number, node.y as number, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color as string;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
            if (globalScale >= 0.8) {
              ctx.font = `${fontSize}px sans-serif`;
              ctx.fillStyle = 'rgba(255,255,255,0.9)';
              ctx.textAlign = 'center';
              ctx.fillText(label.split(' ')[0], node.x as number, (node.y as number) + r + fontSize);
            }
          }}
        />
      )}
    </div>
  );
}
