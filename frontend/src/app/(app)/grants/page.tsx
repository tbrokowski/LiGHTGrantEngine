'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { grants } from '@/lib/api';
import ProposalCard, { GrantSummary } from '@/components/grants/ProposalCard';
import PendingCard from '@/components/grants/PendingCard';
import ActiveGrantCard from '@/components/grants/ActiveGrantCard';
import GrantColorPicker from '@/components/grants/GrantColorPicker';

type TabId = 'proposals' | 'pending' | 'active';

const TABS: { id: TabId; label: string; stage: string; emptyText: string }[] = [
  { id: 'proposals', label: 'Proposals', stage: 'proposal', emptyText: 'No proposals in progress. Create one or convert a shortlisted opportunity.' },
  { id: 'pending', label: 'Pending', stage: 'pending', emptyText: 'No submissions awaiting decisions.' },
  { id: 'active', label: 'Active', stage: 'active', emptyText: 'No funded grants yet.' },
];

function SkeletonRow() {
  return (
    <div className="px-6 py-4 animate-pulse" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
      <div className="flex items-start gap-3">
        <div className="w-1 h-12 rounded-full shrink-0" style={{ background: 'var(--rule-subtle)' }} />
        <div className="flex-1 space-y-2">
          <div className="h-2.5 w-14 rounded" style={{ background: 'var(--rule-subtle)' }} />
          <div className="h-3.5 w-64 rounded" style={{ background: 'var(--rule-subtle)' }} />
          <div className="h-2.5 w-36 rounded" style={{ background: 'var(--rule-subtle)' }} />
        </div>
        <div className="h-6 w-14 rounded" style={{ background: 'var(--rule-subtle)' }} />
      </div>
    </div>
  );
}

interface NewGrantForm {
  title: string;
  funder: string;
  pi_name: string;
  external_deadline: string;
  is_personal: boolean;
  color: string | null;
}

function NewGrantModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState<NewGrantForm>({ title: '', funder: '', pi_name: '', external_deadline: '', is_personal: false, color: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);

  function set<K extends keyof NewGrantForm>(k: K, v: NewGrantForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        is_personal: form.is_personal,
        grant_stage: 'proposal',
      };
      if (form.funder) payload.funder = form.funder;
      if (form.pi_name) payload.pi_name = form.pi_name;
      if (form.external_deadline) payload.external_deadline = form.external_deadline;
      if (form.color) payload.color = form.color;
      const res = await grants.create(payload);
      onCreated(res.data.id);
    } catch {
      setError('Failed to create grant. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New Proposal</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button type="button" onClick={() => set('is_personal', false)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${!form.is_personal ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Organization
            </button>
            <button type="button" onClick={() => set('is_personal', true)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${form.is_personal ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Personal draft
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Title <span className="text-red-400">*</span></label>
            <input ref={firstRef} type="text" value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="Grant title"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
          </div>
          <GrantColorPicker value={form.color} onChange={color => set('color', color)} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Funder</label>
              <input type="text" value={form.funder} onChange={e => set('funder', e.target.value)} placeholder="Organization"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Deadline</label>
              <input type="date" value={form.external_deadline} onChange={e => set('external_deadline', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NewActiveGrantForm {
  title: string;
  funder: string;
  pi_name: string;
  award_amount: string;
  currency: string;
  external_deadline: string;
  is_personal: boolean;
  color: string | null;
}

function NewActiveGrantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<NewActiveGrantForm>({
    title: '', funder: '', pi_name: '', award_amount: '', currency: 'USD',
    external_deadline: '', is_personal: false, color: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);

  function set<K extends keyof NewActiveGrantForm>(k: K, v: NewActiveGrantForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        grant_stage: 'active',
        is_personal: form.is_personal,
      };
      if (form.funder) payload.funder = form.funder;
      if (form.pi_name) payload.pi_name = form.pi_name;
      if (form.award_amount) {
        const parsed = parseFloat(form.award_amount.replace(/,/g, ''));
        if (!isNaN(parsed)) payload.award_amount = parsed;
      }
      if (form.currency) payload.currency = form.currency;
      if (form.external_deadline) payload.external_deadline = form.external_deadline;
      if (form.color) payload.color = form.color;
      await grants.create(payload);
      onCreated();
    } catch {
      setError('Failed to create grant. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Add Active Grant</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button type="button" onClick={() => set('is_personal', false)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${!form.is_personal ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Organization
            </button>
            <button type="button" onClick={() => set('is_personal', true)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${form.is_personal ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Personal
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Title <span className="text-red-400">*</span></label>
            <input ref={firstRef} type="text" value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="Grant title"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
          </div>
          <GrantColorPicker value={form.color} onChange={color => set('color', color)} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Funder</label>
              <input type="text" value={form.funder} onChange={e => set('funder', e.target.value)} placeholder="Organization"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Lead PI</label>
              <input type="text" value={form.pi_name} onChange={e => set('pi_name', e.target.value)} placeholder="PI name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Currency</label>
              <input type="text" value={form.currency} onChange={e => set('currency', e.target.value)} placeholder="USD"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Award amount</label>
              <input type="text" value={form.award_amount} onChange={e => set('award_amount', e.target.value)} placeholder="e.g. 250000"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">End / reporting deadline</label>
            <input type="date" value={form.external_deadline} onChange={e => set('external_deadline', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add Grant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GrantsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('proposals');
  const [allGrants, setAllGrants] = useState<GrantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showActiveModal, setShowActiveModal] = useState(false);

  function loadGrants() {
    grants.list({})
      .then(r => setAllGrants(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    loadGrants();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCreated(id: string) {
    router.push(`/grants/${id}`);
  }

  function handleActiveCreated() {
    setShowActiveModal(false);
    setLoading(true);
    loadGrants();
  }

  function handleStageChange(id: string, newStage: string) {
    setAllGrants(prev => prev.map(g => g.id === id ? { ...g, grant_stage: newStage } : g));
  }

  function handleDeadlineChange(id: string, deadline: string | null) {
    setAllGrants(prev => prev.map(g => g.id === id ? { ...g, external_deadline: deadline } : g));
  }

  async function handleDelete(id: string) {
    if (!confirm('Permanently delete this grant? This cannot be undone.')) return;
    try {
      await grants.delete(id);
      setAllGrants(prev => prev.filter(g => g.id !== id));
    } catch {
      alert('Failed to delete grant.');
    }
  }

  const currentTab = TABS.find(t => t.id === tab)!;
  const tabGrants = useMemo(() => {
    let result = allGrants.filter(g => g.grant_stage === currentTab.stage);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(g =>
        g.title.toLowerCase().includes(q) ||
        (g.funder ?? '').toLowerCase().includes(q) ||
        (g.pi_name ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [allGrants, tab, search, currentTab.stage]);

  const counts = useMemo(() => ({
    proposals: allGrants.filter(g => g.grant_stage === 'proposal').length,
    pending: allGrants.filter(g => g.grant_stage === 'pending').length,
    active: allGrants.filter(g => g.grant_stage === 'active').length,
  }), [allGrants]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      {showModal && (
        <NewGrantModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
      {showActiveModal && (
        <NewActiveGrantModal
          onClose={() => setShowActiveModal(false)}
          onCreated={handleActiveCreated}
        />
      )}

      {/* ── Tab bar + actions ───────────────────────── */}
      <div
        className="px-7 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-raised)' }}
      >
        {/* Tabs — ledger label style with bottom accent */}
        <div className="flex items-center gap-0">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setSearch(''); }}
                className="relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors"
                style={{ color: active ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
              >
                {t.label}
                {counts[t.id] > 0 && (
                  <span
                    className="mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                    style={{
                      background: active ? 'var(--accent-secondary)' : 'var(--surface-sunken)',
                      color: active ? 'var(--accent-primary)' : 'var(--ink-faint)',
                    }}
                  >
                    {counts[t.id]}
                  </span>
                )}
                {/* Bottom accent rule */}
                {active && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ background: 'var(--accent-primary)' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 py-2.5">
          {/* Search */}
          {!loading && tabGrants.length > 0 && (
            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                style={{ color: 'var(--ink-faint)' }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search"
                className="pl-7 pr-3 py-1.5 text-sm transition-colors"
                style={{
                  border: '1px solid var(--rule-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-sunken)',
                  color: 'var(--ink-primary)',
                  outline: 'none',
                  width: '180px',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
          )}

          {tab === 'active' ? (
            <button
              onClick={() => setShowActiveModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={{
                border: '1px solid var(--state-success)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--state-success)',
                background: 'var(--state-success-bg)',
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Active
            </button>
          ) : (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={{
                borderRadius: 'var(--radius-sm)',
                color: 'var(--ink-inverse)',
                background: 'var(--accent-primary)',
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Proposal
            </button>
          )}
        </div>
      </div>

      {/* ── Grant list ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Section label */}
        {!loading && tabGrants.length > 0 && (
          <div
            className="px-7 py-2 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}
          >
            <span className="ledger-label">
              {currentTab.label} · {tabGrants.length} {tabGrants.length === 1 ? 'grant' : 'grants'}
              {search && ` matching "${search}"`}
            </span>
          </div>
        )}

        <div style={{ background: 'var(--surface-raised)' }}>
          {loading ? (
            <><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
          ) : tabGrants.length === 0 ? (
            <div className="px-7 py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{currentTab.emptyText}</p>
              {tab === 'active' && (
                <button
                  onClick={() => setShowActiveModal(true)}
                  className="mt-3 text-xs underline underline-offset-2"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  Add the first active grant
                </button>
              )}
            </div>
          ) : tab === 'proposals' ? (
            tabGrants.map(g => (
              <ProposalCard
                key={g.id}
                grant={g}
                onStageChange={handleStageChange}
                onDelete={handleDelete}
              />
            ))
          ) : tab === 'pending' ? (
            tabGrants.map(g => (
              <PendingCard
                key={g.id}
                grant={g}
                onStageChange={handleStageChange}
                onDelete={handleDelete}
              />
            ))
          ) : (
            tabGrants.map(g => (
              <ActiveGrantCard
                key={g.id}
                grant={g}
                onStageChange={handleStageChange}
                onDelete={handleDelete}
                onDeadlineChange={handleDeadlineChange}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
