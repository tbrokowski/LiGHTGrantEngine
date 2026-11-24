'use client';
// Funders (LiGHT): the partners who fund or move money, sorted into whale
// tiers. Tasks, open threads and outreach up top, one sliding row of tiers,
// then the people in the chosen tier. Each funder is a partner record, so a card opens the
// partner page with its meetings, tasks, reminders and history.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Search, X } from 'lucide-react';
import { funders as fundersApi, partnerTasks } from '@/lib/api';
import { CrmTask, btnOutline, btnPrimary, card } from '@/components/crm/crmUi';
import TaskRow from '@/components/crm/TaskRow';
import NewTaskModal from '@/components/crm/NewTaskModal';
import AddFunderModal from '@/components/funders/AddFunderModal';
import LogTouchModal from '@/components/funders/LogTouchModal';
import OutreachCard, { OutreachItem } from '@/components/funders/OutreachCard';
import OpenThreadsCard from '@/components/funders/OpenThreadsCard';
import TierBar from '@/components/funders/TierBar';
import FunderCards from '@/components/funders/FunderCards';
import { TIER_BY_KEY, TierKey, TierMark, tierRank } from '@/components/funders/tiers';
import { FunderRow, funderHref } from '@/components/funders/types';

type Modal = null
  | { kind: 'add'; tier?: TierKey }
  | { kind: 'log'; f?: FunderRow }
  | { kind: 'task'; f?: FunderRow };

const TIER_KEY = 'funders:tier';
const TASKS_SHOWN = 5;

function readTier(): TierKey | null {
  try {
    const v = localStorage.getItem(TIER_KEY);
    return v && TIER_BY_KEY[v] ? (v as TierKey) : null;
  } catch { return null; }
}

function FundersHome() {
  const router = useRouter();
  const [rows, setRows] = useState<FunderRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CrmTask[] | null>(null);
  const [allTasks, setAllTasks] = useState(false);
  const [outreach, setOutreach] = useState<OutreachItem[] | null>(null);
  const [tier, setTier] = useState<TierKey | null>(null);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTier(readTier()); }, []);
  function pickTier(t: TierKey | null) {
    setTier(t);
    try { t ? localStorage.setItem(TIER_KEY, t) : localStorage.removeItem(TIER_KEY); } catch { /* per-viewer convenience only */ }
  }

  const load = useCallback(() => {
    fundersApi.list()
      .then(r => { setRows(r.data.funders || []); setLoadError(null); })
      .catch(e => { setRows([]); setLoadError(e?.response?.data?.detail || 'Could not load funders.'); });
    fundersApi.followUps().then(r => setTasks(r.data || [])).catch(() => setTasks([]));
    fundersApi.outreach().then(r => setOutreach(r.data || [])).catch(() => setOutreach([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // New people are researched online in the background; refresh until done.
  useEffect(() => {
    if (!rows?.some(r => r.enrichment_status === 'pending')) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [rows, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || e.metaKey || e.ctrlKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'n') { e.preventDefault(); setModal({ kind: 'add' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function changeTier(f: FunderRow, next: TierKey | null, undoable = true) {
    const prev = f.funder_tier;
    setRows(rs => rs ? (next ? rs.map(r => r.id === f.id ? { ...r, funder_tier: next } : r) : rs.filter(r => r.id !== f.id)) : rs);
    try {
      await fundersApi.setTier(f.id, next);
      if (!undoable) { load(); return; }
      const msg = next ? `${f.name} → ${TIER_BY_KEY[next].label}` : `${f.name} removed from Funders (still in Partners)`;
      toast.success(msg, { duration: 7000, action: { label: 'Undo', onClick: () => changeTier({ ...f, funder_tier: next ?? prev }, prev, false) } });
      if (!next) load();
    } catch {
      toast.error(`Couldn't move ${f.name}.`);
      load();
    }
  }

  async function toggleTask(t: CrmTask) {
    const status = t.status === 'done' ? 'open' : 'done';
    setTasks(ts => ts?.map(x => x.id === t.id ? { ...x, status } : x) ?? null);
    try { await partnerTasks.update(t.id, { status }); load(); } catch { load(); }
  }

  // Search narrows everyone first, so the tier counts show where matches are.
  const matches = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => [r.name, r.org_name, r.title, r.city, r.country, r.email, ...(r.tags || [])]
      .some(v => v && v.toLowerCase().includes(needle)));
  }, [rows, q]);

  const counts = useMemo(() => {
    const m = new Map<TierKey, number>();
    for (const r of matches ?? []) m.set(r.funder_tier, (m.get(r.funder_tier) ?? 0) + 1);
    return m;
  }, [matches]);

  const people = useMemo(() => {
    if (!matches) return null;
    return matches
      .filter(r => !tier || r.funder_tier === tier)
      .sort((a, b) => tierRank(a.funder_tier) - tierRank(b.funder_tier) || (b.priority - a.priority) || a.name.localeCompare(b.name));
  }, [matches, tier]);

  const shownTasks = allTasks ? tasks : tasks?.slice(0, TASKS_SHOWN);
  const active = tier ? TIER_BY_KEY[tier] : null;
  const dropOnTier = (id: string, t: TierKey) => {
    const f = rows?.find(r => r.id === id);
    if (f && f.funder_tier !== t) changeTier(f, t);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      <header className="px-4 md:px-7 py-4 flex items-center justify-between gap-4 shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-2xl leading-none">🐋</span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Funders</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {rows ? <><span className="mono-data">{rows.length}</span> people · shared with Partners</> : 'Loading…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="hidden md:flex items-center gap-2 h-9 px-3 w-72 text-[13px]"
            style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', color: 'var(--ink-muted)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" />
            <input ref={searchRef} aria-label="Search funders" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search name, organization, place…" className="flex-1 bg-transparent outline-none" style={{ color: 'var(--ink-primary)' }} />
            {q ? <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X className="w-3.5 h-3.5" /></button>
              : <kbd className="mono-data text-[10px] px-1.5 rounded" style={{ background: 'var(--surface-base)' }}>/</kbd>}
          </label>
          <button type="button" onClick={() => setModal({ kind: 'add', tier: tier ?? undefined })} className="flex items-center gap-1.5 h-9 px-3.5 text-[13px] font-medium" style={btnPrimary}>
            <Plus className="w-3.5 h-3.5" />Add funder
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-7 py-5 flex flex-col gap-6">
        {loadError && (
          <p className="text-sm px-4 py-3 rounded-[var(--radius-md)]" style={{ background: 'var(--state-danger-bg)', color: 'var(--state-danger)' }}>{loadError}</p>
        )}

        {/* Tasks and open threads, then outreach */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <div className="flex flex-col gap-5 min-w-0">
            <div className="flex flex-col min-w-0" style={card}>
              <div className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-3">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  Tasks <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{tasks?.length || ''}</span>
                </h2>
                <button type="button" onClick={() => setModal({ kind: 'task' })} className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium" style={btnOutline}>
                  <Plus className="w-3.5 h-3.5" />New task
                </button>
              </div>
              <ul>
                {tasks === null && Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="px-[18px] py-3" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
                    <div className="h-4 w-1/2 animate-pulse rounded" style={{ background: 'var(--surface-sunken)' }} />
                  </li>
                ))}
                {shownTasks?.map(t => <TaskRow key={t.id} task={t} onToggle={toggleTask} />)}
                {tasks && !tasks.length && (
                  <li className="px-[18px] py-8 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
                    No open tasks on funders.
                  </li>
                )}
              </ul>
              {(tasks?.length ?? 0) > TASKS_SHOWN && (
                <button type="button" onClick={() => setAllTasks(v => !v)} className="px-[18px] py-2.5 text-left text-[13px] hover:bg-[var(--surface-sunken)]"
                  style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
                  {allTasks ? 'Show fewer' : `Show all ${tasks!.length}`}
                </button>
              )}
            </div>
            <OpenThreadsCard funders={rows ?? []} />
          </div>
          <OutreachCard items={outreach} onLog={() => setModal({ kind: 'log' })} />
        </section>

        {/* Tiers, then the people in the chosen one */}
        <section className="flex flex-col gap-4">
          <TierBar counts={counts} total={matches?.length ?? 0} active={tier} onSelect={pickTier} onDropPerson={dropOnTier} />

          <div className="flex items-center gap-3 min-w-0">
            {active && <TierMark tier={active} size={32} />}
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {active?.label ?? 'All funders'} <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{people?.length ?? ''}</span>
              </h2>
              <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                {q ? `Matching “${q.trim()}”` : active?.blurb ?? 'Everyone, top tiers first. Drag a card onto a tier to move them.'}
              </p>
            </div>
          </div>

          {people === null ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-[var(--radius-card)]" style={{ background: 'var(--surface-sunken)' }} />)}
            </div>
          ) : people.length ? (
            <FunderCards rows={people} onTier={changeTier}
              onLog={f => setModal({ kind: 'log', f })} onTask={f => setModal({ kind: 'task', f })} />
          ) : (
            <div className="py-12 px-6 text-center" style={{ ...card, borderStyle: 'dashed' }}>
              <div className="text-3xl mb-2" aria-hidden>{active?.emoji ?? '🐋'}</div>
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                {q ? 'No one matches.' : active ? `No ${active.label} yet. Drag someone onto the tier above, or add them.` : 'No funders yet.'}
              </p>
              {!q && (
                <button type="button" onClick={() => setModal({ kind: 'add', tier: tier ?? undefined })} className="mt-4 h-9 px-3.5 text-[13px] font-medium" style={btnPrimary}>
                  Add {active ? `to ${active.label}` : 'a funder'}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {modal?.kind === 'add' && (
        <AddFunderModal initialTier={modal.tier} onClose={() => setModal(null)}
          onAdded={id => { setModal(null); load(); toast.success('Added to Funders', { action: { label: 'Open', onClick: () => router.push(funderHref(id)) } }); }} />
      )}
      {modal?.kind === 'log' && (
        <LogTouchModal partner={modal.f} choices={rows ?? []} onClose={() => setModal(null)} onLogged={load} />
      )}
      {modal?.kind === 'task' && (
        <NewTaskModal target={modal.f ? { kind: 'partner', id: modal.f.id, name: modal.f.name } : undefined}
          onClose={() => setModal(null)} onCreated={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}

export default function FundersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}>
      <FundersHome />
    </Suspense>
  );
}
