'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { grants } from '@/lib/api';

interface Grant {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  pi_name: string | null;
  external_deadline: string | null;
  internal_deadline: string | null;
  requested_amount: number | null;
  currency: string | null;
  tasks?: { status: string }[];
}

const STATUS_STYLES: Record<string, string> = {
  scoping: 'text-gray-500 bg-gray-100',
  go_no_go_pending: 'text-amber-700 bg-amber-50',
  concept_note_drafting: 'text-blue-600 bg-blue-50',
  full_proposal_drafting: 'text-blue-700 bg-blue-100',
  internal_review: 'text-violet-700 bg-violet-50',
  pi_review: 'text-violet-700 bg-violet-100',
  submitted: 'text-emerald-700 bg-emerald-50',
  awarded: 'text-emerald-800 bg-emerald-100',
  rejected: 'text-red-600 bg-red-50',
};

const STATUS_LABEL: Record<string, string> = {
  scoping: 'Scoping',
  go_no_go_pending: 'Go / No-go',
  concept_note_drafting: 'Concept Note',
  full_proposal_drafting: 'Drafting',
  internal_review: 'Internal Review',
  pi_review: 'PI Review',
  submitted: 'Submitted',
  awarded: 'Awarded',
  rejected: 'Rejected',
};

// Groups for the compact filter pill row
const FILTER_GROUPS = [
  { id: 'all', label: 'All', statuses: [] as string[] },
  {
    id: 'pipeline',
    label: 'Pipeline',
    statuses: ['scoping', 'go_no_go_pending', 'concept_note_drafting', 'full_proposal_drafting'],
  },
  {
    id: 'review',
    label: 'In Review',
    statuses: ['internal_review', 'pi_review'],
  },
  { id: 'submitted', label: 'Submitted', statuses: ['submitted'] },
  { id: 'closed', label: 'Awarded & Rejected', statuses: ['awarded', 'rejected'] },
];

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function DeadlineChip({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-gray-300 text-sm">No deadline</span>;
  const days = daysUntil(dateStr);
  const label = formatDate(dateStr);

  if (days === null) return null;

  let colorClass = 'text-gray-500';
  let dotClass = 'bg-gray-300';
  let daysLabel = '';

  if (days < 0) {
    colorClass = 'text-gray-400';
    dotClass = 'bg-gray-300';
    daysLabel = 'Passed';
  } else if (days <= 7) {
    colorClass = 'text-red-600';
    dotClass = 'bg-red-500';
    daysLabel = `${days}d left`;
  } else if (days <= 14) {
    colorClass = 'text-amber-600';
    dotClass = 'bg-amber-400';
    daysLabel = `${days}d left`;
  } else if (days <= 30) {
    colorClass = 'text-amber-500';
    dotClass = 'bg-amber-300';
    daysLabel = `${days}d left`;
  }

  return (
    <div className={`flex items-center gap-1.5 ${colorClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span className="text-sm whitespace-nowrap">{label}</span>
      {daysLabel && (
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-md bg-current/10 opacity-80">
          {daysLabel}
        </span>
      )}
    </div>
  );
}

function TaskProgress({ tasks }: { tasks?: { status: string }[] }) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2 mt-2.5">
      <div className="h-1 w-32 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gray-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 tabular-nums">{done}/{total} tasks</span>
    </div>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center px-5 py-3 bg-white border border-gray-100 rounded-2xl shadow-sm min-w-[88px]">
      <span className={`text-2xl font-semibold tracking-tight ${highlight ? 'text-red-500' : 'text-gray-900'}`}>
        {value}
      </span>
      <span className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm px-6 py-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-3 w-20 bg-gray-100 rounded-full" />
          <div className="h-4 w-64 bg-gray-100 rounded-full" />
          <div className="h-3 w-40 bg-gray-100 rounded-full" />
        </div>
        <div className="h-4 w-24 bg-gray-100 rounded-full mt-1" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1 w-32 bg-gray-100 rounded-full" />
        <div className="h-3 w-16 bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// New Grant Modal
// ────────────────────────────────────────────────────────────────

const ALL_STATUSES = [
  { value: 'scoping', label: 'Scoping' },
  { value: 'go_no_go_pending', label: 'Go / No-go' },
  { value: 'concept_note_drafting', label: 'Concept Note' },
  { value: 'full_proposal_drafting', label: 'Drafting' },
  { value: 'internal_review', label: 'Internal Review' },
  { value: 'pi_review', label: 'PI Review' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'rejected', label: 'Rejected' },
];

interface NewGrantForm {
  title: string;
  funder: string;
  pi_name: string;
  external_deadline: string;
  status: string;
  requested_amount: string;
  currency: string;
}

function NewGrantModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState<NewGrantForm>({
    title: '',
    funder: '',
    pi_name: '',
    external_deadline: '',
    status: 'scoping',
    requested_amount: '',
    currency: 'USD',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function set<K extends keyof NewGrantForm>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        status: form.status,
      };
      if (form.funder) payload.funder = form.funder;
      if (form.pi_name) payload.pi_name = form.pi_name;
      if (form.external_deadline) payload.external_deadline = form.external_deadline;
      if (form.requested_amount) payload.requested_amount = parseFloat(form.requested_amount.replace(/,/g, ''));
      if (form.currency) payload.currency = form.currency;

      const res = await grants.create(payload);
      onCreated(res.data.id);
    } catch {
      setError('Failed to create grant. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New Grant</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              ref={firstRef}
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Grant title"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Funder</label>
              <input
                type="text"
                value={form.funder}
                onChange={e => set('funder', e.target.value)}
                placeholder="Organization"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Lead PI</label>
              <input
                type="text"
                value={form.pi_name}
                onChange={e => set('pi_name', e.target.value)}
                placeholder="PI name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Deadline</label>
              <input
                type="date"
                value={form.external_deadline}
                onChange={e => set('external_deadline', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              >
                {ALL_STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Requested amount</label>
              <input
                type="text"
                value={form.requested_amount}
                onChange={e => set('requested_amount', e.target.value)}
                placeholder="e.g. 250,000"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={e => set('currency', e.target.value)}
                placeholder="USD"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating…' : 'Create Grant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Grant Card
// ────────────────────────────────────────────────────────────────

function GrantCard({
  grant,
  onArchive,
  onDelete,
}: {
  grant: Grant;
  onArchive: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusStyle = STATUS_STYLES[grant.status] ?? 'text-gray-500 bg-gray-100';
  const statusLabel = STATUS_LABEL[grant.status] ?? grant.status.replace(/_/g, ' ');

  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);

  const isDrafting = ['full_proposal_drafting', 'concept_note_drafting'].includes(grant.status);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  async function handleArchive() {
    if (busy) return;
    if (!confirm(`Move "${grant.title}" to archive? It will be removed from active grants.`)) return;
    setBusy('archive');
    setMenuOpen(false);
    try {
      await onArchive(grant.id);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (busy) return;
    if (!confirm(`Permanently delete "${grant.title}"? This cannot be undone.`)) return;
    setBusy('delete');
    setMenuOpen(false);
    try {
      await onDelete(grant.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="group bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-px transition-all duration-150 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0">
          <span className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full mb-2 ${statusStyle}`}>
            {statusLabel}
          </span>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-gray-600 transition-colors leading-snug">
            {grant.title}
          </h2>
          {meta.length > 0 && (
            <p className="text-xs text-gray-400 mt-1 truncate">
              {meta.join(' · ')}
            </p>
          )}
          <TaskProgress tasks={grant.tasks} />
        </Link>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen(v => !v)}
                disabled={!!busy}
                aria-label="Grant actions"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-10">
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={!!busy}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {busy === 'archive' ? 'Archiving…' : 'Move to archive'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!!busy}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <DeadlineChip dateStr={grant.external_deadline} />
          {isDrafting && (
            <Link
              href={`/grants/${grant.id}?tab=editor`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Write Proposal
            </Link>
          )}
          <Link href={`/grants/${grant.id}`} className="text-gray-200 group-hover:text-gray-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────

export default function GrantsPage() {
  const router = useRouter();
  const [allGrants, setAllGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    grants.list({})
      .then(r => setAllGrants(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(id: string) {
    router.push(`/grants/${id}`);
  }

  async function handleArchive(id: string) {
    try {
      await grants.archive(id);
      setAllGrants(prev => prev.filter(g => g.id !== id));
    } catch {
      alert('Failed to archive grant. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await grants.delete(id);
      setAllGrants(prev => prev.filter(g => g.id !== id));
    } catch {
      alert('Failed to delete grant. Please try again.');
    }
  }

  const filtered = useMemo(() => {
    const group = FILTER_GROUPS.find(g => g.id === activeGroup);
    let result = allGrants;

    if (group && group.statuses.length > 0) {
      result = result.filter(g => group.statuses.includes(g.status));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        g =>
          g.title.toLowerCase().includes(q) ||
          (g.funder ?? '').toLowerCase().includes(q) ||
          (g.pi_name ?? '').toLowerCase().includes(q),
      );
    }

    return result;
  }, [allGrants, activeGroup, search]);

  // Summary stats (always from full list)
  const totalCount = allGrants.length;
  const dueSoonCount = allGrants.filter(g => {
    const d = daysUntil(g.external_deadline);
    return d !== null && d >= 0 && d <= 30;
  }).length;
  const inReviewCount = allGrants.filter(g =>
    g.status === 'internal_review' || g.status === 'pi_review',
  ).length;
  const awardedCount = allGrants.filter(g => g.status === 'awarded').length;

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto">
      {showModal && (
        <NewGrantModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Active Grants</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Grant
        </button>
      </div>

      {/* ── Summary stat chips ── */}
      {!loading && (
        <div className="flex gap-3 mb-7 flex-wrap">
          <StatChip label="Total" value={totalCount} />
          <StatChip label="Due in 30 days" value={dueSoonCount} highlight={dueSoonCount > 0} />
          <StatChip label="In Review" value={inReviewCount} />
          <StatChip label="Awarded" value={awardedCount} />
        </div>
      )}

      {/* ── Filter row ── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* Group pills */}
        <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl">
          {FILTER_GROUPS.map(g => (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeGroup === g.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or funder…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
          />
        </div>

        {/* Result count */}
        {!loading && (
          <span className="text-xs text-gray-400 ml-auto">
            {filtered.length} grant{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Cards ── */}
      <div className="space-y-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm px-6 py-16 text-center">
            <p className="text-sm font-medium text-gray-400">
              {search.trim() ? 'No grants match your search.' : 'No grants in this group.'}
            </p>
            {!search.trim() && activeGroup === 'all' && (
              <Link
                href="/opportunities"
                className="inline-block mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
              >
                Convert an opportunity →
              </Link>
            )}
          </div>
        ) : (
          filtered.map(g => (
            <GrantCard
              key={g.id}
              grant={g}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
