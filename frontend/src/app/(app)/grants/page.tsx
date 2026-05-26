'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { grants } from '@/lib/api';
import ProposalCard, { GrantSummary } from '@/components/grants/ProposalCard';
import PendingCard from '@/components/grants/PendingCard';
import ActiveGrantCard from '@/components/grants/ActiveGrantCard';

type TabId = 'proposals' | 'pending' | 'active';

const TABS: { id: TabId; label: string; stage: string; emptyText: string }[] = [
  { id: 'proposals', label: 'Proposals', stage: 'proposal', emptyText: 'No proposals in progress. Create one or convert a shortlisted opportunity.' },
  { id: 'pending', label: 'Pending', stage: 'pending', emptyText: 'No submissions awaiting decisions.' },
  { id: 'active', label: 'Active', stage: 'active', emptyText: 'No funded grants yet.' },
];

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2.5">
          <div className="h-3 w-16 bg-gray-100 rounded-full" />
          <div className="h-4 w-56 bg-gray-100 rounded-full" />
          <div className="h-3 w-32 bg-gray-100 rounded-full" />
        </div>
        <div className="h-6 w-16 bg-gray-100 rounded-lg" />
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
}

function NewGrantModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState<NewGrantForm>({ title: '', funder: '', pi_name: '', external_deadline: '', is_personal: false });
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

export default function GrantsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('proposals');
  const [allGrants, setAllGrants] = useState<GrantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

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

  function handleStageChange(id: string, newStage: string) {
    setAllGrants(prev => prev.map(g => g.id === id ? { ...g, grant_stage: newStage } : g));
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
    <div className="px-8 py-8 max-w-4xl mx-auto">
      {showModal && (
        <NewGrantModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Grants</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Proposal
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(''); }}
            className={`relative px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === t.id ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-500'
              }`}>
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      {!loading && tabGrants.length > 0 && (
        <div className="relative mb-5 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {loading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : tabGrants.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl px-6 py-16 text-center">
            <p className="text-sm font-medium text-gray-400">{currentTab.emptyText}</p>
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
            />
          ))
        ) : (
          tabGrants.map(g => (
            <ActiveGrantCard key={g.id} grant={g} />
          ))
        )}
      </div>
    </div>
  );
}
