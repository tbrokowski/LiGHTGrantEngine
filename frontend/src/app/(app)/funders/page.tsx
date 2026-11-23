'use client';
// Funders (LiGHT): the partners who fund or move money, sorted into whale
// tiers. Each funder is a partner record, so opening one goes to the partner
// page with its meetings, tasks, reminders and history.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Search, X } from 'lucide-react';
import { funders as fundersApi, partners as partnersApi, partnerTasks } from '@/lib/api';
import { CrmTask, Segmented, btnPrimary, card } from '@/components/crm/crmUi';
import TaskRow from '@/components/crm/TaskRow';
import NewTaskModal from '@/components/crm/NewTaskModal';
import AddFunderModal from '@/components/funders/AddFunderModal';
import LogTouchModal from '@/components/funders/LogTouchModal';
import FunderTable, { TierCountChip } from '@/components/funders/FunderTable';
import FunderBoard from '@/components/funders/FunderBoard';
import FunderOrgs from '@/components/funders/FunderOrgs';
import { TIERS, TIER_BY_KEY, TierKey, tierRank } from '@/components/funders/tiers';
import { FunderRow, funderHref, health } from '@/components/funders/types';

type View = 'grid' | 'tiers' | 'orgs';
type Sort = 'tier' | 'name' | 'priority' | 'last_touch' | 'follow_up';
type Modal = null | { kind: 'add'; tier?: TierKey } | { kind: 'log'; f: FunderRow } | { kind: 'task'; f: FunderRow };

const VIEW_KEY = 'funders:view';
const FOLLOW_UPS_SHOWN = 5;

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'grid' || v === 'tiers' || v === 'orgs' ? v : 'tiers';
  } catch { return 'tiers'; }
}

function FundersHome() {
  const router = useRouter();
  const [rows, setRows] = useState<FunderRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<CrmTask[] | null>(null);
  const [allFollowUps, setAllFollowUps] = useState(false);
  const [view, setView] = useState<View>('tiers');
  const [sort, setSort] = useState<Sort>('tier');
  const [tierFilter, setTierFilter] = useState<TierKey | null>(null);
  const [q, setQ] = useState('');
  const [showEmpty, setShowEmpty] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setView(readView()); }, []);
  function changeView(v: View) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-viewer convenience only */ }
  }

  const load = useCallback(() => {
    fundersApi.list()
      .then(r => { setRows(r.data.funders || []); setLoadError(null); })
      .catch(e => { setRows([]); setLoadError(e?.response?.data?.detail || 'Could not load funders.'); });
    fundersApi.followUps().then(r => setFollowUps(r.data || [])).catch(() => setFollowUps([]));
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

  async function changeTier(f: FunderRow, tier: TierKey | null, undoable = true) {
    const prev = f.funder_tier;
    setRows(rs => rs ? (tier ? rs.map(r => r.id === f.id ? { ...r, funder_tier: tier } : r) : rs.filter(r => r.id !== f.id)) : rs);
    try {
      await fundersApi.setTier(f.id, tier);
      if (!undoable) { load(); return; }
      const msg = tier ? `${f.name} → ${TIER_BY_KEY[tier].label}` : `${f.name} removed from Funders (still in Partners)`;
      toast.success(msg, { duration: 7000, action: { label: 'Undo', onClick: () => changeTier({ ...f, funder_tier: tier ?? prev }, prev, false) } });
      if (!tier) load();
    } catch {
      toast.error(`Couldn't move ${f.name}.`);
      load();
    }
  }

  async function changePriority(f: FunderRow, p: number) {
    setRows(rs => rs?.map(r => r.id === f.id ? { ...r, priority: p } : r) ?? null);
    try { await partnersApi.update(f.id, { priority: p }); } catch { load(); }
  }

  async function toggleTask(t: CrmTask) {
    const status = t.status === 'done' ? 'open' : 'done';
    setFollowUps(ts => ts?.map(x => x.id === t.id ? { ...x, status } : x) ?? null);
    try { await partnerTasks.update(t.id, { status }); load(); } catch { load(); }
  }

  const counts = useMemo(() => {
    const m = new Map<TierKey, number>();
    for (const r of rows ?? []) m.set(r.funder_tier, (m.get(r.funder_tier) ?? 0) + 1);
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (tierFilter && r.funder_tier !== tierFilter) return false;
      if (!needle) return true;
      return [r.name, r.org_name, r.title, r.city, r.country, r.email, ...(r.tags || [])]
        .some(v => v && v.toLowerCase().includes(needle));
    });
  }, [rows, q, tierFilter]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const time = (s?: string | null) => (s ? new Date(s).getTime() : 0);
    const byName = (a: FunderRow, b: FunderRow) => a.name.localeCompare(b.name);
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return byName(a, b);
      if (sort === 'priority') return (b.priority - a.priority) || tierRank(a.funder_tier) - tierRank(b.funder_tier) || byName(a, b);
      if (sort === 'last_touch') return (time(a.last_touch) - time(b.last_touch)) || byName(a, b);
      if (sort === 'follow_up') {
        const due = (r: FunderRow) => time(r.open_tasks ? r.next_task_due : r.next_contact_date) || Infinity;
        return (due(a) - due(b)) || byName(a, b);
      }
      return tierRank(a.funder_tier) - tierRank(b.funder_tier) || (b.priority - a.priority) || byName(a, b);
    });
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const orgs = new Set(list.map(r => (r.organization_id || r.org_name || '').toLowerCase()).filter(Boolean));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = (followUps ?? []).filter(t => t.due_date && new Date(t.due_date) < today).length;
    return {
      people: list.length,
      orgs: orgs.size,
      open: (followUps ?? []).length,
      overdue,
      cold: list.filter(r => ['cold', 'none'].includes(health(r.last_touch).key)).length,
      unsorted: counts.get('unsorted') ?? 0,
    };
  }, [rows, followUps, counts]);

  const shownFollowUps = allFollowUps ? followUps : followUps?.slice(0, FOLLOW_UPS_SHOWN);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      <header className="px-7 py-4 flex items-center justify-between gap-4 shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-2xl leading-none">🐋</span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Funders</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {rows ? <><span className="mono-data">{stats.people}</span> people · <span className="mono-data">{stats.orgs}</span> organizations · shared with Partners</> : 'Loading…'}
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
          <button type="button" onClick={() => setModal({ kind: 'add' })} className="flex items-center gap-1.5 h-9 px-3.5 text-[13px] font-medium" style={btnPrimary}>
            <Plus className="w-3.5 h-3.5" />Add funder
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 flex flex-col gap-5">
        {loadError && (
          <p className="text-sm px-4 py-3 rounded-[var(--radius-md)]" style={{ background: 'var(--state-danger-bg)', color: 'var(--state-danger)' }}>{loadError}</p>
        )}

        {/* At a glance + follow-ups */}
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 gap-px overflow-hidden" style={{ ...card, background: 'var(--rule-subtle)' }}>
            {[
              { label: 'Funders', value: stats.people, hint: 'People on this tab' },
              { label: 'Organizations', value: stats.orgs, hint: 'Foundations, offices, networks' },
              { label: 'Open follow-ups', value: stats.open, hint: stats.overdue ? `${stats.overdue} overdue` : 'None overdue', tone: stats.overdue ? 'var(--state-danger)' : undefined },
              { label: 'Cold or never contacted', value: stats.cold, hint: 'No touch in 60+ days' },
              { label: 'Waiting for a tier', value: stats.unsorted, hint: 'In “To sort”', onClick: stats.unsorted ? () => { changeView('tiers'); setTierFilter(null); } : undefined },
              { label: 'Top tiers', value: (['blue_whale', 'whale_pod', 'matriarch'] as TierKey[]).reduce((n, k) => n + (counts.get(k) ?? 0), 0), hint: 'Blue whales, pods, matriarchs' },
            ].map(s => (
              <button key={s.label} type="button" onClick={s.onClick} disabled={!s.onClick}
                className="text-left px-4 py-3 disabled:cursor-default enabled:hover:bg-[var(--surface-sunken)]" style={{ background: 'var(--surface-base)' }}>
                <div className="ledger-label">{s.label}</div>
                <div className="mono-data text-[22px] font-semibold leading-tight mt-1" style={{ color: 'var(--ink-primary)' }}>{rows ? s.value : '–'}</div>
                <div className="text-[11px] mt-0.5" style={{ color: s.tone ?? 'var(--ink-muted)' }}>{s.hint}</div>
              </button>
            ))}
          </div>

          <div className="xl:col-span-7 flex flex-col" style={card}>
            <div className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
                Follow-ups <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{followUps?.length ?? ''}</span>
              </h2>
              <span className="hidden sm:inline text-xs" style={{ color: 'var(--ink-muted)' }}>Open tasks on funders, soonest first</span>
            </div>
            <ul>
              {shownFollowUps?.map(t => <TaskRow key={t.id} task={t} onToggle={toggleTask} />)}
              {followUps && !followUps.length && (
                <li className="px-[18px] py-8 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
                  No open follow-ups. Log a touch on someone to set one.
                </li>
              )}
            </ul>
            {(followUps?.length ?? 0) > FOLLOW_UPS_SHOWN && (
              <button type="button" onClick={() => setAllFollowUps(v => !v)} className="px-[18px] py-2.5 text-left text-[13px] hover:bg-[var(--surface-sunken)]"
                style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
                {allFollowUps ? 'Show fewer' : `Show all ${followUps!.length}`}
              </button>
            )}
          </div>
        </section>

        {/* Toolbar */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Segmented label="View" value={view} onChange={changeView}
              options={[{ value: 'tiers', label: 'By tier' }, { value: 'grid', label: 'Grid' }, { value: 'orgs', label: 'Organizations' }]} />
            <div className="flex items-center gap-3">
              {view === 'grid' && (
                <select aria-label="Sort funders" value={sort} onChange={e => setSort(e.target.value as Sort)}
                  className="h-8 px-2 text-xs rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)', border: 0 }}>
                  <option value="tier">Sort: Tier</option>
                  <option value="priority">Sort: Priority</option>
                  <option value="follow_up">Sort: Next follow-up</option>
                  <option value="last_touch">Sort: Longest since contact</option>
                  <option value="name">Sort: Name</option>
                </select>
              )}
              {view === 'tiers' && (
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                  <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} />
                  Show empty tiers
                </label>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by tier">
            <button type="button" onClick={() => setTierFilter(null)} aria-pressed={!tierFilter}
              className="h-7 px-2.5 rounded-full text-xs font-medium"
              style={{ border: `1px solid ${!tierFilter ? 'var(--ink-secondary)' : 'var(--rule-subtle)'}`, background: !tierFilter ? 'var(--surface-sunken)' : 'var(--surface-base)', color: 'var(--ink-primary)' }}>
              All <span className="mono-data" style={{ color: 'var(--ink-muted)' }}>{rows?.length ?? ''}</span>
            </button>
            {TIERS.map(t => (
              <TierCountChip key={t.key} tierKey={t.key} count={counts.get(t.key) ?? 0} active={tierFilter === t.key}
                onClick={() => setTierFilter(f => f === t.key ? null : t.key)} />
            ))}
          </div>
        </section>

        {/* Views */}
        {sorted === null ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)' }} />)}</div>
        ) : !rows?.length ? (
          <div className="py-16 text-center" style={card}>
            <div className="text-4xl mb-3" aria-hidden>🐋 🐬 🦈</div>
            <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>No funders yet</p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>Add someone from Partners or a new person, and pick their tier.</p>
            <button type="button" onClick={() => setModal({ kind: 'add' })} className="mt-4 h-9 px-3.5 text-[13px] font-medium" style={btnPrimary}>Add funder</button>
          </div>
        ) : !sorted.length ? (
          <p className="py-12 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>No one matches.</p>
        ) : view === 'grid' ? (
          <div className="overflow-hidden" style={card}>
            <FunderTable rows={sorted} onTier={changeTier} onPriority={changePriority}
              onLog={f => setModal({ kind: 'log', f })} onTask={f => setModal({ kind: 'task', f })} />
          </div>
        ) : view === 'tiers' ? (
          <FunderBoard rows={sorted} showEmpty={showEmpty && !tierFilter && !q} onTier={changeTier}
            onLog={f => setModal({ kind: 'log', f })} onAdd={tier => setModal({ kind: 'add', tier })} />
        ) : (
          <FunderOrgs rows={sorted} />
        )}
      </div>

      {modal?.kind === 'add' && (
        <AddFunderModal initialTier={modal.tier} onClose={() => setModal(null)}
          onAdded={id => { setModal(null); load(); toast.success('Added to Funders', { action: { label: 'Open', onClick: () => router.push(funderHref(id)) } }); }} />
      )}
      {modal?.kind === 'log' && <LogTouchModal partner={modal.f} onClose={() => setModal(null)} onLogged={load} />}
      {modal?.kind === 'task' && (
        <NewTaskModal target={{ kind: 'partner', id: modal.f.id, name: modal.f.name }} onClose={() => setModal(null)} onCreated={() => { setModal(null); load(); }} />
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
