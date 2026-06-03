'use client';
import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  LayoutList, Columns, Calendar, Compass, Search, X,
  Download, AlertTriangle, Plus, Trash2,
  UserCheck, Layers, Network as NetworkIcon,
} from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import PartnerForm, { PartnerFormData } from '@/components/crm/PartnerForm';
import PartnersKanban from '@/components/crm/PartnersKanban';
import PartnerNetworkGraph from '@/components/crm/PartnerNetworkGraph';
import PartnerCalendar from '@/components/crm/PartnerCalendar';
import CommandPalette from '@/components/crm/CommandPalette';
import PartnerAnalytics from '@/components/crm/PartnerAnalytics';
import SavedViewsTabs, { DEFAULT_VIEWS, SavedView } from '@/components/crm/SavedViewsTabs';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { SkeletonPartnerRow } from '@/components/ui/SkeletonCard';
import { SkeletonKanban } from '@/components/ui/SkeletonCard';

type ViewMode = 'table' | 'kanban' | 'network' | 'calendar';
type SortField = 'name' | 'organization' | 'stage' | 'last_contact' | 'next_contact';

const STAGE_TOKENS: Record<string, { bg: string; color: string }> = {
  prospect:      { bg: 'var(--surface-sunken)',   color: 'var(--ink-muted)' },
  qualified:     { bg: 'var(--state-info-bg)',    color: 'var(--state-info)' },
  engaged:       { bg: 'var(--state-info-bg)',    color: 'var(--accent-primary)' },
  collaborating: { bg: 'var(--state-success-bg)', color: 'var(--state-success)' },
  alumni:        { bg: 'var(--state-warning-bg)', color: 'var(--state-warning)' },
};
const STAGE_LABELS: Record<string, string> = {
  prospect: 'Prospect', qualified: 'Qualified', engaged: 'Engaged',
  collaborating: 'Collaborating', alumni: 'Alumni',
};

const STATUS_TOKENS: Record<string, { bg: string; color: string }> = {
  active:   { bg: 'var(--state-success-bg)', color: 'var(--state-success)' },
  prospect: { bg: 'var(--state-warning-bg)', color: 'var(--state-warning)' },
  inactive: { bg: 'var(--surface-sunken)',   color: 'var(--ink-muted)' },
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Active', prospect: 'Prospect', inactive: 'Inactive',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

interface Partner {
  id: string;
  name: string;
  email?: string;
  organization?: string;
  title?: string;
  department?: string;
  country?: string;
  tags: string[];
  project_types: string[];
  status: string;
  relationship_stage: string;
  h_index?: number;
  enrichment_status: string;
  next_contact_date?: string;
  updated_at?: string;
  owner_id?: string;
  owner_name?: string;
  meetings?: { id: string; title: string; scheduled_at?: string; meeting_type: string; completed_at?: string }[];
  grant_links_count?: number;
}

function EngagementDot({ nextContact, lastUpdated }: { nextContact?: string; lastUpdated?: string }) {
  const now = new Date();
  if (nextContact && new Date(nextContact) < now)
    return <div className="w-2 h-2 rounded-full" style={{ background: 'var(--state-danger)' }} title="Follow-up overdue" />;
  if (!lastUpdated)
    return <div className="w-2 h-2 rounded-full" style={{ background: 'var(--rule-strong)' }} title="Not contacted" />;
  const daysSince = (now.getTime() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 14)
    return <div className="w-2 h-2 rounded-full" style={{ background: 'var(--state-success)' }} title="Recently active" />;
  if (daysSince < 45)
    return <div className="w-2 h-2 rounded-full" style={{ background: 'var(--state-warning)' }} title="Check in soon" />;
  return <div className="w-2 h-2 rounded-full" style={{ background: 'var(--state-danger)', opacity: 0.6 }} title="Stale relationship" />;
}

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: 'asc' | 'desc' }) {
  const active = field === sortBy;
  const color = active ? 'var(--accent-primary)' : 'var(--rule-strong)';
  const rotate = active && sortDir === 'asc' ? 'rotate(180deg)' : undefined;
  return (
    <svg
      className="w-3 h-3 ml-1 inline"
      viewBox="0 0 10 6"
      fill="currentColor"
      style={{ color, transform: rotate }}
    >
      <path d="M0 0l5 6 5-6H0z" />
    </svg>
  );
}

function PartnersPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const viewParam = searchParams.get('view') as ViewMode | null;

  const [partnerList, setPartnerList] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [view, setView] = useState<ViewMode>(viewParam || 'table');
  const [showForm, setShowForm] = useState(false);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('last_contact');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<string>('all');
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [bulkConfirm, setBulkConfirm] = useState<null | 'delete'>(null);
  const [bulkStage, setBulkStage] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const buildParams = useCallback((view?: SavedView): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    if (search) params.q = search;
    if (statusFilter) params.status = statusFilter;
    if (stageFilter) params.stage = stageFilter;
    params.sort_by = sortBy;
    params.sort_dir = sortDir;

    if (view) {
      if (view.filters.status) params.status = view.filters.status;
      if (view.filters.relationship_stage) params.stage = view.filters.relationship_stage;
      if (view.filters.owner === 'me') params.owner_me = true;
      if (view.filters.overdue) params.overdue = true;
      if (view.filters.daysInactive) params.days_inactive = view.filters.daysInactive;
    }
    return params;
  }, [search, statusFilter, stageFilter, sortBy, sortDir]);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const currentView = DEFAULT_VIEWS.find(v => v.id === activeView);
      const params = buildParams(currentView);
      const res = await partnersApi.list(params);
      setPartnerList(res.data);
    } finally { setLoading(false); }
  }, [activeView, buildParams]);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  useEffect(() => {
    partnersApi.upcomingContacts(14).then(res => setUpcomingCount(res.data.length)).catch(() => {});
  }, []);

  // Compute view badge counts (client-side approximation)
  useEffect(() => {
    const now = new Date();
    const counts: Record<string, number> = {
      all: partnerList.length,
      overdue: partnerList.filter(p => p.next_contact_date && new Date(p.next_contact_date) < now).length,
      active: partnerList.filter(p => p.relationship_stage === 'collaborating').length,
    };
    setViewCounts(counts);
  }, [partnerList]);

  function handleViewChange(sv: SavedView) {
    setActiveView(sv.id);
    setSearch('');
    setStatusFilter('');
    setStageFilter('');
  }

  function handleSort(field: SortField) {
    if (field === sortBy) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }

  function setViewAndUpdate(v: ViewMode) {
    setView(v);
    const url = new URL(window.location.href);
    if (v === 'table') url.searchParams.delete('view');
    else url.searchParams.set('view', v);
    router.replace(url.pathname + url.search);
  }

  async function handleCreate(data: PartnerFormData) {
    await partnersApi.create(data as unknown as Record<string, unknown>);
    setShowForm(false);
    fetchPartners();
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === partnerList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(partnerList.map(p => p.id)));
    }
  }

  async function handleBulkStage() {
    if (!bulkStage) return;
    await partnersApi.bulkUpdate(Array.from(selectedIds), { relationship_stage: bulkStage });
    setSelectedIds(new Set());
    setBulkStage('');
    fetchPartners();
  }

  async function handleBulkDelete() {
    await partnersApi.bulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    setBulkConfirm(null);
    fetchPartners();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await partnersApi.exportCsv();
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'partners.csv';
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  const filteredPartners = useMemo(() => {
    // Server does the heavy lifting; just client-side filter for the search box
    if (!search) return partnerList;
    const q = search.toLowerCase();
    return partnerList.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.organization || '').toLowerCase().includes(q)
    );
  }, [partnerList, search]);

  const allSelected = filteredPartners.length > 0 && selectedIds.size === filteredPartners.length;
  const someSelected = selectedIds.size > 0;

  const selectStyle: React.CSSProperties = {
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-sunken)',
    color: 'var(--ink-secondary)',
    outline: 'none',
    fontSize: '0.875rem',
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      {/* Header */}
      <div
        className="px-7 py-4 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      >
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Partners</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            {loading ? 'Loading…' : `${filteredPartners.length} partner${filteredPartners.length !== 1 ? 's' : ''}`}
            {upcomingCount > 0 && (
              <span className="ml-2 font-medium" style={{ color: 'var(--state-warning)' }}>
                · {upcomingCount} follow-up{upcomingCount !== 1 ? 's' : ''} due
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPalette(true)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 transition-colors"
            style={{
              color: 'var(--ink-muted)',
              border: '1px solid var(--rule-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd
              className="text-xs px-1 py-0.5 hidden sm:inline"
              style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--radius-xs)', color: 'var(--ink-faint)' }}
            >
              ⌘K
            </kbd>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 transition-colors disabled:opacity-50"
            style={{
              color: 'var(--ink-muted)',
              border: '1px solid var(--rule-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
            title="Export CSV"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <Link
            href="/partners/find"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 font-medium transition-colors"
            style={{
              color: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
              opacity: 0.85,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Find Partners</span>
          </Link>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 font-medium transition-colors"
            style={{
              background: 'var(--accent-primary)',
              color: 'var(--ink-inverse)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />New
          </button>
        </div>
      </div>

      {/* Analytics panel */}
      {view === 'table' && <PartnerAnalytics />}

      {/* Saved views tabs */}
      {view === 'table' && (
        <div className="px-7 pt-3">
          <SavedViewsTabs
            activeView={activeView}
            onViewChange={handleViewChange}
            counts={viewCounts}
          />
        </div>
      )}

      {/* View switcher + Filters */}
      <div className="px-7 py-3 flex flex-wrap items-center gap-2 shrink-0">
        <div
          className="flex items-center overflow-hidden"
          style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)' }}
        >
          {([
            { key: 'table', icon: <LayoutList className="w-3.5 h-3.5" />, label: 'Table' },
            { key: 'kanban', icon: <Columns className="w-3.5 h-3.5" />, label: 'Pipeline' },
            { key: 'network', icon: <NetworkIcon className="w-3.5 h-3.5" />, label: 'Network' },
            { key: 'calendar', icon: <Calendar className="w-3.5 h-3.5" />, label: 'Calendar' },
          ] as const).map(v => {
            const isActive = view === v.key;
            return (
              <button
                key={v.key}
                onClick={() => setViewAndUpdate(v.key)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  background: isActive ? 'var(--accent-primary)' : 'transparent',
                  color: isActive ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                {v.icon}{v.label}
              </button>
            );
          })}
        </div>

        {view === 'table' && (
          <>
            <input
              type="text"
              placeholder="Search by name, email, org…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-2 text-sm w-64"
              style={selectStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2"
              style={selectStyle}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              className="px-3 py-2"
              style={selectStyle}
            >
              <option value="">All stages</option>
              <option value="prospect">Prospect</option>
              <option value="qualified">Qualified</option>
              <option value="engaged">Engaged</option>
              <option value="collaborating">Collaborating</option>
              <option value="alumni">Alumni</option>
            </select>
            {(search || statusFilter || stageFilter) && (
              <button
                onClick={() => { setSearch(''); setStatusFilter(''); setStageFilter(''); }}
                className="text-sm flex items-center gap-1 transition-colors"
                style={{ color: 'var(--ink-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
              >
                <X className="w-3.5 h-3.5" />Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && view === 'table' && (
        <div
          className="mx-7 mb-3 flex items-center gap-2 px-4 py-2.5"
          style={{
            background: 'var(--state-info-bg)',
            border: '1px solid var(--state-info)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--state-info)',
          }}
        >
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <div className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />
              <select
                value={bulkStage}
                onChange={e => setBulkStage(e.target.value)}
                className="text-xs px-2 py-1"
                style={{
                  border: '1px solid var(--state-info)',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--surface-panel)',
                  color: 'var(--state-info)',
                  outline: 'none',
                }}
              >
                <option value="">Set stage…</option>
                <option value="prospect">Prospect</option>
                <option value="qualified">Qualified</option>
                <option value="engaged">Engaged</option>
                <option value="collaborating">Collaborating</option>
                <option value="alumni">Alumni</option>
              </select>
              {bulkStage && (
                <button
                  onClick={handleBulkStage}
                  className="text-xs px-2.5 py-1 transition-colors"
                  style={{
                    background: 'var(--accent-primary)',
                    color: 'var(--ink-inverse)',
                    borderRadius: 'var(--radius-xs)',
                  }}
                >
                  Apply
                </button>
              )}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 text-xs px-2.5 py-1 transition-colors"
              style={{
                border: '1px solid var(--state-info)',
                borderRadius: 'var(--radius-xs)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-panel)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Download className="w-3 h-3" />Export
            </button>
            <button
              onClick={() => setBulkConfirm('delete')}
              className="flex items-center gap-1 text-xs px-2.5 py-1 transition-colors"
              style={{
                color: 'var(--state-danger)',
                border: '1px solid var(--state-danger)',
                borderRadius: 'var(--radius-xs)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-danger-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Trash2 className="w-3 h-3" />Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs transition-colors"
              style={{ color: 'var(--ink-faint)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="flex-1 overflow-y-auto px-7 pb-6">
          <div style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-4 py-3 w-5"></th>
                  <th className="text-left px-4 py-3 ledger-label">
                    <button onClick={() => handleSort('name')} className="flex items-center hover:opacity-80">
                      Name <SortIcon field="name" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 ledger-label hidden md:table-cell">
                    <button onClick={() => handleSort('organization')} className="flex items-center hover:opacity-80">
                      Organization <SortIcon field="organization" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 ledger-label hidden lg:table-cell">
                    <button onClick={() => handleSort('stage')} className="flex items-center hover:opacity-80">
                      Stage <SortIcon field="stage" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 ledger-label hidden lg:table-cell">Expertise</th>
                  <th className="text-left px-4 py-3 ledger-label hidden xl:table-cell">
                    <button onClick={() => handleSort('next_contact')} className="flex items-center hover:opacity-80">
                      Follow-up <SortIcon field="next_contact" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 ledger-label">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => <SkeletonPartnerRow key={i} />)
                ) : filteredPartners.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>
                      {search || statusFilter || stageFilter ? 'No matches found.' : 'No partners yet. Add your first partner.'}
                    </td>
                  </tr>
                ) : filteredPartners.map(p => {
                  const stageTok = STAGE_TOKENS[p.relationship_stage] ?? STAGE_TOKENS.prospect;
                  const statusTok = STATUS_TOKENS[p.status] ?? STATUS_TOKENS.inactive;
                  return (
                    <tr
                      key={p.id}
                      className="transition-colors"
                      style={{
                        borderBottom: '1px solid var(--rule-subtle)',
                        background: selectedIds.has(p.id) ? 'var(--state-info-bg)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (!selectedIds.has(p.id)) e.currentTarget.style.background = 'var(--selection-bg)'; }}
                      onMouseLeave={e => { if (!selectedIds.has(p.id)) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td className="px-4 py-3 w-8">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3 w-5">
                        <EngagementDot nextContact={p.next_contact_date} lastUpdated={p.updated_at} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/partners/${p.id}`}
                          className="font-medium block transition-colors"
                          style={{ color: 'var(--ink-primary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-primary)')}
                        >
                          {p.name}
                        </Link>
                        {p.email && (
                          <div className="mono-data text-[11px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>{p.email}</div>
                        )}
                        {p.title && (
                          <div className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: 'var(--ink-faint)' }}>{p.title}</div>
                        )}
                        {p.owner_name && (
                          <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                            <UserCheck className="w-3 h-3" />{p.owner_name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="truncate max-w-[160px] text-sm" style={{ color: 'var(--ink-muted)' }}>{p.organization ?? '—'}</div>
                        {p.department && (
                          <div className="text-xs truncate max-w-[160px]" style={{ color: 'var(--ink-faint)' }}>{p.department}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                          style={{ background: stageTok.bg, color: stageTok.color }}
                        >
                          {STAGE_LABELS[p.relationship_stage] || p.relationship_stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {p.tags.slice(0, 2).map(t => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                              style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
                            >
                              {t}
                            </span>
                          ))}
                          {p.h_index != null && (
                            <span
                              className="mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)', border: '1px solid var(--rule-subtle)' }}
                            >
                              h:{p.h_index}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        {p.next_contact_date ? (
                          <span
                            className="mono-data text-[11px] font-medium flex items-center gap-1"
                            style={{ color: isOverdue(p.next_contact_date) ? 'var(--state-danger)' : 'var(--ink-muted)' }}
                          >
                            {isOverdue(p.next_contact_date) && <AlertTriangle className="w-3 h-3" />}
                            {formatDate(p.next_contact_date)}
                          </span>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                          style={{ background: statusTok.bg, color: statusTok.color }}
                        >
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kanban view */}
      {view === 'kanban' && (
        <div className="flex-1 overflow-y-auto px-7 pb-6">
          {loading ? <SkeletonKanban /> : <PartnersKanban partners={partnerList} onRefresh={fetchPartners} />}
        </div>
      )}

      {/* Network view */}
      {view === 'network' && (
        <div className="flex-1 overflow-hidden">
          <PartnerNetworkGraph partners={partnerList.map(p => ({
            ...p,
            grant_links_count: p.grant_links_count ?? 0,
          }))} />
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && (
        <div className="flex-1 overflow-y-auto px-7 pb-6">
          <PartnerCalendar partners={partnerList.map(p => ({
            id: p.id,
            name: p.name,
            meetings: p.meetings || [],
            next_contact_date: p.next_contact_date,
          }))} />
        </div>
      )}

      {/* New Partner Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            style={{
              background: 'var(--surface-panel)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--rule-subtle)',
              boxShadow: 'var(--shadow-floating)',
            }}
          >
            <div
              className="px-6 py-4 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--rule-subtle)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>New Partner</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-xl transition-colors"
                style={{ color: 'var(--ink-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5">
              <PartnerForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="Create partner" />
            </div>
          </div>
        </div>
      )}

      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onNewPartner={() => setShowForm(true)}
        />
      )}

      {bulkConfirm === 'delete' && (
        <ConfirmModal
          title={`Delete ${selectedIds.size} partner${selectedIds.size !== 1 ? 's' : ''}?`}
          message="This will permanently delete the selected partner records and all their interactions, meetings, and documents. This cannot be undone."
          confirmLabel="Delete All"
          destructive
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkConfirm(null)}
        />
      )}
    </div>
  );
}

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}>
      <PartnersPageInner />
    </Suspense>
  );
}
