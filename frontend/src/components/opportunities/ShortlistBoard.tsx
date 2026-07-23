'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import FunderLogo from './FunderLogo';
import OpportunityActions, { type OpportunityActionHandlers } from './OpportunityActions';
import OpportunityTypeBadge from './OpportunityTypeBadge';
import { MatchScorePill } from './OpportunityRow';
import { formatDate, type Opportunity, type ShortlistCategory } from './types';
import { opportunities } from '@/lib/api';

interface Props extends OpportunityActionHandlers {
  items: Opportunity[];
  scope: 'user' | 'org';
  onNavigate?: (id: string) => void;
}

// Fit-score auto-placement: a card with no explicit lane lands in the default
// lane matching its priority tier. Keys are matched against lane names seeded
// by the backend (_DEFAULT_SHORTLIST_LANES) — keep in sync.
const PRIORITY_TO_LANE_NAME: Record<string, string> = {
  high: 'High priority',
  high_priority: 'High priority',
  medium: 'Medium priority',
  worth_reviewing: 'Medium priority',
  low: 'Low priority',
  watchlist: 'Low priority',
  low_fit: 'Low priority',
};

function Card({
  opp,
  scope,
  onNavigate,
  ...handlers
}: { opp: Opportunity; scope: 'user' | 'org' } & OpportunityActionHandlers & { onNavigate?: (id: string) => void }) {
  const mode = scope === 'org' ? 'org-shortlist' : 'shortlist';
  return (
    <div className="rounded-lg overflow-hidden flex flex-col" style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-raised)' }}>
      <Link href={`/opportunities/${opp.id}`} className="block p-3 flex-1 min-w-0" onClick={() => onNavigate?.(opp.id)}>
        <div className="flex items-start gap-1.5 mb-1">
          <span className="mt-0.5 shrink-0"><MatchScorePill priority={opp.priority} fitScore={opp.fit_score} /></span>
          <span className="text-sm leading-snug line-clamp-2" style={{ color: 'var(--ink-primary)', fontWeight: 500 }}>
            {opp.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
          <FunderLogo url={opp.funder_logo_url} name={opp.funder} />
          <span className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{opp.funder ?? '—'}</span>
        </div>
        {opp.opportunity_type && <OpportunityTypeBadge type={opp.opportunity_type} size="xs" />}
        <p className="mono-data text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
          {formatDate(opp.deadline) ?? 'No deadline listed'}
        </p>
      </Link>
      <div className="px-3 pb-2.5 flex items-center justify-end" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
        <OpportunityActions opp={opp} mode={mode} className="pt-2" {...handlers} />
      </div>
    </div>
  );
}

function ColumnHeader({
  category,
  count,
  onRename,
  onDelete,
}: {
  category: ShortlistCategory;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);

  function commit() {
    const next = draft.trim();
    if (next && next !== category.name) onRename(next);
    setEditing(false);
  }

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-t-lg" style={{ background: 'var(--surface-sunken)', borderLeft: `3px solid ${category.color ?? 'var(--rule-strong)'}` }}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(category.name); setEditing(false); } }}
          className="min-w-0 flex-1 text-xs font-semibold bg-transparent outline-none"
          style={{ color: 'var(--ink-primary)', borderBottom: '1px solid var(--rule-strong)' }}
        />
      ) : (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--ink-muted)' }}>{category.name}</span>
          <span className="mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>· {count}</span>
        </div>
      )}
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="w-5 h-5 flex items-center justify-center rounded text-xs leading-none transition-colors"
          style={{ color: 'var(--ink-faint)' }}
          title="Lane options"
          aria-label="Lane options"
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-6 z-20 w-32 rounded-md overflow-hidden text-xs" style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-raised)', boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))' }}>
              <button
                onClick={() => { setMenuOpen(false); setDraft(category.name); setEditing(true); }}
                className="w-full text-left px-3 py-1.5 transition-colors hover:opacity-80"
                style={{ color: 'var(--ink-primary)' }}
              >
                Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="w-full text-left px-3 py-1.5 transition-colors hover:opacity-80"
                style={{ color: 'var(--state-danger, #dc2626)', borderTop: '1px solid var(--rule-subtle)' }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ShortlistBoard({ items, scope, onNavigate, ...handlers }: Props) {
  const [categories, setCategories] = useState<ShortlistCategory[]>([]);
  const [loading, setLoading] = useState(true);
  // opp id → category id override applied optimistically after a drag, before
  // the server round-trip lands and the parent re-fetches `items`.
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    opportunities.shortlistCategories(scope)
      .then(res => { if (alive) setCategories(res.data); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope]);

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  );

  // Resolve each card's effective lane: optimistic override, then its stored
  // lane (if that lane still exists), then the fit-derived default lane.
  const effectiveLane = useMemo(() => {
    const byName = new Map(sortedCats.map(c => [c.name, c.id]));
    const validIds = new Set(sortedCats.map(c => c.id));
    const firstId = sortedCats[0]?.id ?? null;
    const resolve = (opp: Opportunity): string | null => {
      if (opp.id in overrides) return overrides[opp.id];
      if (opp.shortlist_category_id && validIds.has(opp.shortlist_category_id)) return opp.shortlist_category_id;
      const laneName = PRIORITY_TO_LANE_NAME[opp.priority ?? ''];
      const defaultId = laneName ? byName.get(laneName) : undefined;
      return defaultId ?? firstId;
    };
    const map: Record<string, string | null> = {};
    for (const opp of items) map[opp.id] = resolve(opp);
    return map;
  }, [items, sortedCats, overrides]);

  const itemsByLane = useMemo(() => {
    const map: Record<string, Opportunity[]> = {};
    for (const c of sortedCats) map[c.id] = [];
    for (const opp of items) {
      const laneId = effectiveLane[opp.id];
      if (laneId && map[laneId]) map[laneId].push(opp);
    }
    return map;
  }, [items, sortedCats, effectiveLane]);

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    const destLane = result.destination.droppableId;
    const oppId = result.draggableId;
    if (destLane === result.source.droppableId) return;
    setOverrides(prev => ({ ...prev, [oppId]: destLane }));
    try {
      await opportunities.setShortlistCategory(oppId, { scope, category_id: destLane });
    } catch {
      setOverrides(prev => { const next = { ...prev }; delete next[oppId]; return next; });
    }
  }

  async function addCategory() {
    const name = newName.trim();
    if (!name) { setAdding(false); return; }
    const res = await opportunities.createShortlistCategory({ scope, name });
    setCategories(prev => [...prev, res.data]);
    setNewName('');
    setAdding(false);
  }

  async function renameCategory(id: string, name: string) {
    setCategories(prev => prev.map(c => (c.id === id ? { ...c, name } : c)));
    await opportunities.updateShortlistCategory(id, { name });
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this lane? Cards in it move back to their default lane.')) return;
    setCategories(prev => prev.filter(c => c.id !== id));
    // Drop optimistic overrides pointing at the removed lane.
    setOverrides(prev => {
      const next: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(prev)) if (v !== id) next[k] = v;
      return next;
    });
    await opportunities.deleteShortlistCategory(id);
  }

  if (loading) {
    return <div className="px-5 py-16 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>Loading board…</div>;
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-3 items-start">
        {sortedCats.map(cat => (
          <div key={cat.id} className="flex-shrink-0 w-64 flex flex-col">
            <ColumnHeader
              category={cat}
              count={itemsByLane[cat.id]?.length ?? 0}
              onRename={name => renameCategory(cat.id, name)}
              onDelete={() => deleteCategory(cat.id)}
            />
            <Droppable droppableId={cat.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="min-h-24 rounded-b-lg p-2 space-y-2 transition-colors"
                  style={{
                    border: '1px solid var(--rule-subtle)',
                    borderTop: 'none',
                    background: snapshot.isDraggingOver ? 'var(--surface-sunken)' : 'transparent',
                  }}
                >
                  {(itemsByLane[cat.id] ?? []).map((opp, index) => (
                    <Draggable key={opp.id} draggableId={opp.id} index={index}>
                      {(prov, snap) => (
                        <div
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          {...prov.dragHandleProps}
                          style={{ ...prov.draggableProps.style, opacity: snap.isDragging ? 0.9 : 1 }}
                        >
                          <Card opp={opp} scope={scope} onNavigate={onNavigate} {...handlers} />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {(itemsByLane[cat.id]?.length ?? 0) === 0 && !snapshot.isDraggingOver && (
                    <p className="text-[11px] text-center py-4" style={{ color: 'var(--ink-faint)' }}>Drop grants here</p>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        ))}

        {/* Add-category lane */}
        <div className="flex-shrink-0 w-64">
          {adding ? (
            <div className="rounded-lg p-2" style={{ border: '1px dashed var(--rule-strong)' }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onBlur={addCategory}
                onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') { setNewName(''); setAdding(false); } }}
                placeholder="Category name"
                className="w-full text-xs bg-transparent outline-none px-2 py-1.5 rounded"
                style={{ color: 'var(--ink-primary)', border: '1px solid var(--rule-subtle)' }}
              />
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full text-xs font-medium px-3 py-2.5 rounded-lg transition-colors"
              style={{ border: '1px dashed var(--rule-strong)', color: 'var(--ink-muted)' }}
            >
              + Add category
            </button>
          )}
        </div>
      </div>
    </DragDropContext>
  );
}
