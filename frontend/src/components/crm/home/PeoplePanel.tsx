'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, Trash2, Download, FolderPlus } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import ConfirmModal from '@/components/ui/ConfirmModal';
import {
  Avatar, GroupChip, GroupRef, PriorityBars, Segmented, TagPill, WeekStrip, card, btnOutline, btnQuiet, sinceLabel,
} from '../crmUi';

export interface PersonRow {
  id: string;
  name: string;
  email?: string;
  organization?: string;
  title?: string;
  tags: string[];
  priority: number;
  groups: GroupRef[];
  weeks: number[];
  last_touch?: string | null;
  enrichment_status: string;
  created_at?: string;
}

type Sort = 'priority' | 'name' | 'last_touch' | 'created';

const GRID = '28px 28px minmax(0,2.2fr) minmax(0,1.6fr) minmax(0,2fr) 64px 96px';

export default function PeoplePanel({
  refreshKey, onAddPerson, onImport, importing, onAddToGroup, onChanged,
}: {
  refreshKey: number;
  onAddPerson: () => void;
  onImport: () => void;
  importing: boolean;
  onAddToGroup: (ids: string[]) => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState<0 | 1 | 2 | 3>(0);
  const [sort, setSort] = useState<Sort>('priority');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prioMenu, setPrioMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const params: Record<string, unknown> = { limit: 500, sort_by: 'name', sort_dir: 'asc' };
    if (q.trim()) params.q = q.trim();
    if (prio) params.priority = prio;
    partnersApi.list(params).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [q, prio]);

  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load, q, refreshKey]);
  useEffect(() => { setSelected(new Set()); }, [q, prio]);

  // Keep polling while any row is still being researched online.
  useEffect(() => {
    if (!rows?.some(r => r.enrichment_status === 'pending')) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [rows, load]);

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sorted = useMemo(() => {
    if (!rows) return null;
    const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
    const time = (s?: string | null) => (s ? new Date(s).getTime() : 0);
    return [...rows].sort((a, b) => {
      if (sort === 'priority') return (b.priority - a.priority) || byName(a, b);
      if (sort === 'last_touch') return (time(a.last_touch) - time(b.last_touch)) || byName(a, b);
      if (sort === 'created') return time(b.created_at) - time(a.created_at);
      return byName(a, b);
    });
  }, [rows, sort]);

  async function setPriority(id: string, p: number) {
    setRows(rs => rs?.map(r => r.id === id ? { ...r, priority: p } : r) ?? null);
    try { await partnersApi.update(id, { priority: p }); onChanged(); } catch { load(); }
  }

  async function bulkPriority(p: number) {
    setPrioMenu(false);
    await partnersApi.bulkUpdate(Array.from(selected), { priority: p });
    setSelected(new Set());
    load();
    onChanged();
  }

  async function bulkDelete() {
    await partnersApi.bulkDelete(Array.from(selected));
    setSelected(new Set());
    setConfirmDelete(false);
    load();
    onChanged();
  }

  async function exportCsv() {
    const res = await partnersApi.exportCsv();
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'partners.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const allSelected = !!sorted?.length && selected.size === sorted.length;
  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="flex flex-col min-h-0" style={card}>
      <div className="px-[18px] pt-4 pb-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
            People <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{rows ? rows.length : ''}</span>
          </h2>
          <div className="flex gap-1.5">
            <button type="button" onClick={exportCsv} className="h-[30px] px-2.5 text-xs" style={btnQuiet} title="Export all partners as CSV">Export</button>
            <button type="button" onClick={onImport} disabled={importing} className="h-[30px] px-2.5 text-xs disabled:opacity-50" style={btnQuiet}
              title="Import partners from a CSV (columns: name, email, organization, title, tags)">
              {importing ? 'Importing…' : 'Import CSV'}
            </button>
            <Link href="/partners/find" className="h-[30px] px-2.5 text-xs flex items-center" style={btnQuiet}>Find new</Link>
            <button type="button" onClick={onAddPerson} className="h-[30px] px-2.5 text-xs font-medium" style={btnOutline}>+ Add person</button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex-1 min-w-[200px] flex items-center gap-2 h-[34px] px-2.5 rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" />
            <input ref={searchRef} aria-label="Search people" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search name, institution, tag…" className="flex-1 bg-transparent outline-none text-[13px]" style={{ color: 'var(--ink-primary)' }} />
            {q ? (
              <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X className="w-3.5 h-3.5" /></button>
            ) : <kbd className="mono-data text-[10px] px-1.5 rounded" style={{ background: 'var(--surface-base)' }}>/</kbd>}
          </label>
          <Segmented label="Priority filter" value={prio} onChange={setPrio}
            options={[{ value: 0, label: 'All' }, { value: 3, label: 'P3' }, { value: 2, label: 'P2' }, { value: 1, label: 'P1' }]} />
          <select aria-label="Sort people" value={sort} onChange={e => setSort(e.target.value as Sort)}
            className="h-[34px] px-2 text-xs rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)', border: 0 }}>
            <option value="priority">Priority</option>
            <option value="name">Name</option>
            <option value="last_touch">Longest since contact</option>
            <option value="created">Recently added</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mx-[18px] mb-2 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)' }}>
          <span className="text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>{selected.size} selected</span>
          <div className="flex items-center gap-1.5 ml-auto relative">
            <button type="button" onClick={() => onAddToGroup(Array.from(selected))} className="h-7 px-2.5 text-xs flex items-center gap-1" style={btnQuiet}>
              <FolderPlus className="w-3 h-3" />Add to group
            </button>
            <button type="button" onClick={() => setPrioMenu(m => !m)} aria-expanded={prioMenu} className="h-7 px-2.5 text-xs" style={btnQuiet}>Set priority</button>
            {prioMenu && (
              <div className="absolute right-24 top-8 z-20 py-1 min-w-[140px]" style={{ ...card, boxShadow: 'var(--shadow-floating)' }}>
                {[3, 2, 1].map(p => (
                  <button key={p} type="button" onClick={() => bulkPriority(p)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-primary)' }}>
                    <PriorityBars value={p} size="sm" />P{p} · {p === 3 ? 'High' : p === 2 ? 'Medium' : 'Regular'}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={exportCsv} className="h-7 px-2.5 text-xs flex items-center gap-1" style={btnQuiet}><Download className="w-3 h-3" />Export</button>
            <button type="button" onClick={() => setConfirmDelete(true)} className="h-7 px-2.5 text-xs flex items-center gap-1" style={{ ...btnQuiet, color: 'var(--state-danger)' }}>
              <Trash2 className="w-3 h-3" />Delete
            </button>
            <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" style={{ color: 'var(--ink-muted)' }}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      <div className="grid gap-3 px-[18px] py-2 items-center" style={{ gridTemplateColumns: GRID, background: 'var(--surface-sunken)', borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}>
        <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(sorted?.map(r => r.id)))} />
        <span />
        <span className="ledger-label">Name</span>
        <span className="ledger-label">Institution</span>
        <span className="ledger-label">Tags</span>
        <span className="ledger-label">Priority</span>
        <span className="ledger-label">Last 12 wks</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {sorted === null && Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[52px] mx-[18px] animate-pulse" style={{ borderBottom: '1px solid var(--rule-subtle)' }} />
        ))}
        {sorted?.map(p => {
          const researching = p.enrichment_status === 'pending';
          return (
            <div key={p.id} className="grid gap-3 px-[18px] py-2 items-center transition-colors hover:bg-[var(--selection-bg)]"
              style={{ gridTemplateColumns: GRID, borderBottom: '1px solid var(--rule-subtle)', background: selected.has(p.id) ? 'var(--selection-bg)' : undefined }}>
              <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <Avatar name={p.name} />
              <div className="min-w-0">
                <Link href={`/partners/${p.id}`} className="block text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{p.name}</Link>
                <div className="flex gap-2 mt-0.5 min-w-0 overflow-hidden">
                  {p.groups.slice(0, 2).map(g => <GroupChip key={g.id} group={g} />)}
                  {!p.groups.length && p.title && <span className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{p.title}</span>}
                </div>
              </div>
              <div className="text-[13px] truncate" style={{ color: researching && !p.organization ? 'var(--ink-muted)' : 'var(--ink-secondary)', fontStyle: researching && !p.organization ? 'italic' : undefined }}>
                {p.organization || (researching ? 'Researching online…' : '—')}
              </div>
              <div className="flex gap-1 min-w-0 overflow-hidden" title={p.tags.join(', ')}>
                {p.tags.slice(0, 2).map(t => <TagPill key={t} label={t} />)}
                {p.tags.length > 2 && <span className="text-[11px] px-1 shrink-0" style={{ color: 'var(--ink-muted)' }}>+{p.tags.length - 2}</span>}
              </div>
              <PriorityBars value={p.priority} onChange={v => setPriority(p.id, v)} />
              <div className="flex flex-col gap-1">
                <WeekStrip weeks={p.weeks} />
                <span className="mono-data text-[11px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>{sinceLabel(p.last_touch)}</span>
              </div>
            </div>
          );
        })}
        {sorted && !sorted.length && (
          <p className="px-[18px] py-12 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
            {q || prio ? 'No one matches.' : 'No partners yet. Add one, import a CSV, or paste a list of emails.'}
          </p>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${selected.size} partner${selected.size !== 1 ? 's' : ''}?`}
          message="This permanently deletes the selected partner records with their reminders, meetings, tasks and documents. This cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={bulkDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
