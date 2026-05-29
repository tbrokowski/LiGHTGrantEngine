'use client';
import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  LayoutList, Columns, Calendar, Compass, Search, X,
  Download, ChevronUp, ChevronDown, AlertTriangle, Plus, Trash2,
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

const STAGE_STYLES: Record<string, string> = {
  prospect: 'text-gray-500 bg-gray-100',
  qualified: 'text-blue-700 bg-blue-50',
  engaged: 'text-indigo-700 bg-indigo-50',
  collaborating: 'text-green-700 bg-green-50',
  alumni: 'text-amber-700 bg-amber-50',
};
const STAGE_LABELS: Record<string, string> = {
  prospect: 'Prospect', qualified: 'Qualified', engaged: 'Engaged',
  collaborating: 'Collaborating', alumni: 'Alumni',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'text-green-700 bg-green-50',
  prospect: 'text-amber-700 bg-amber-50',
  inactive: 'text-gray-500 bg-gray-100',
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
  if (nextContact && new Date(nextContact) < now) return <div className="w-2 h-2 rounded-full bg-red-500" title="Follow-up overdue" />;
  if (!lastUpdated) return <div className="w-2 h-2 rounded-full bg-gray-300" title="Not contacted" />;
  const daysSince = (now.getTime() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 14) return <div className="w-2 h-2 rounded-full bg-green-500" title="Recently active" />;
  if (daysSince < 45) return <div className="w-2 h-2 rounded-full bg-amber-400" title="Check in soon" />;
  return <div className="w-2 h-2 rounded-full bg-red-400" title="Stale relationship" />;
}

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: 'asc' | 'desc' }) {
  if (field !== sortBy) return <ChevronDown className="w-3 h-3 text-gray-300 ml-1 inline" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-blue-600 ml-1 inline" />
    : <ChevronDown className="w-3 h-3 text-blue-600 ml-1 inline" />;
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

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Partners</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${filteredPartners.length} partner${filteredPartners.length !== 1 ? 's' : ''}`}
            {upcomingCount > 0 && (
              <span className="ml-2 text-amber-700 font-medium">· {upcomingCount} follow-up{upcomingCount !== 1 ? 's' : ''} due</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPalette(true)}
            className="flex items-center gap-2 text-sm text-gray-500 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="text-xs bg-gray-100 px-1 py-0.5 rounded hidden sm:inline">⌘K</kbd>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <Link href="/partners/find"
            className="flex items-center gap-1.5 text-sm text-purple-700 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50 font-medium">
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Find Partners</span>
          </Link>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-lg font-medium">
            <Plus className="w-3.5 h-3.5" />New
          </button>
        </div>
      </div>

      {/* Analytics panel */}
      {view === 'table' && <PartnerAnalytics />}

      {/* Saved views tabs */}
      {view === 'table' && (
        <div className="mb-3">
          <SavedViewsTabs
            activeView={activeView}
            onViewChange={handleViewChange}
            counts={viewCounts}
          />
        </div>
      )}

      {/* View switcher + Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white">
          {([
            { key: 'table', icon: <LayoutList className="w-3.5 h-3.5" />, label: 'Table' },
            { key: 'kanban', icon: <Columns className="w-3.5 h-3.5" />, label: 'Pipeline' },
            { key: 'network', icon: <NetworkIcon className="w-3.5 h-3.5" />, label: 'Network' },
            { key: 'calendar', icon: <Calendar className="w-3.5 h-3.5" />, label: 'Calendar' },
          ] as const).map(v => (
            <button key={v.key} onClick={() => setViewAndUpdate(v.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                view === v.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {v.icon}{v.label}
            </button>
          ))}
        </div>

        {view === 'table' && (
          <>
            <input
              type="text"
              placeholder="Search by name, email, org…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All stages</option>
              <option value="prospect">Prospect</option>
              <option value="qualified">Qualified</option>
              <option value="engaged">Engaged</option>
              <option value="collaborating">Collaborating</option>
              <option value="alumni">Alumni</option>
            </select>
            {(search || statusFilter || stageFilter) && (
              <button onClick={() => { setSearch(''); setStatusFilter(''); setStageFilter(''); }}
                className="text-sm text-gray-400 hover:text-gray-700 flex items-center gap-1">
                <X className="w-3.5 h-3.5" />Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && view === 'table' && (
        <div className="mb-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <div className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <select
                value={bulkStage}
                onChange={e => setBulkStage(e.target.value)}
                className="text-xs border border-blue-300 rounded-lg px-2 py-1 bg-white focus:outline-none"
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
                  className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Apply
                </button>
              )}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 text-xs px-2.5 py-1 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-100"
            >
              <Download className="w-3 h-3" />Export
            </button>
            <button
              onClick={() => setBulkConfirm('delete')}
              className="flex items-center gap-1 text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-3 h-3" />Delete
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="text-left px-4 py-3 w-5"></th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <button onClick={() => handleSort('name')} className="hover:text-gray-700 flex items-center">
                    Name <SortIcon field="name" sortBy={sortBy} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">
                  <button onClick={() => handleSort('organization')} className="hover:text-gray-700 flex items-center">
                    Organization <SortIcon field="organization" sortBy={sortBy} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">
                  <button onClick={() => handleSort('stage')} className="hover:text-gray-700 flex items-center">
                    Stage <SortIcon field="stage" sortBy={sortBy} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Expertise</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">
                  <button onClick={() => handleSort('next_contact')} className="hover:text-gray-700 flex items-center">
                    Follow-up <SortIcon field="next_contact" sortBy={sortBy} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonPartnerRow key={i} />)
              ) : filteredPartners.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    {search || statusFilter || stageFilter ? 'No matches found.' : 'No partners yet. Add your first partner.'}
                  </td>
                </tr>
              ) : filteredPartners.map(p => (
                <tr
                  key={p.id}
                  className={`hover:bg-gray-50 transition-colors ${selectedIds.has(p.id) ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3 w-5">
                    <EngagementDot nextContact={p.next_contact_date} lastUpdated={p.updated_at} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/partners/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700 block">
                      {p.name}
                    </Link>
                    {p.email && <div className="text-xs text-gray-400 mt-0.5">{p.email}</div>}
                    {p.title && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">{p.title}</div>}
                    {p.owner_name && (
                      <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                        <UserCheck className="w-3 h-3" />{p.owner_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                    <div className="truncate max-w-[160px] text-sm">{p.organization ?? '—'}</div>
                    {p.department && <div className="text-xs text-gray-400 truncate max-w-[160px]">{p.department}</div>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_STYLES[p.relationship_stage] || STAGE_STYLES.prospect}`}>
                      {STAGE_LABELS[p.relationship_stage] || p.relationship_stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {p.tags.slice(0, 2).map(t => (
                        <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{t}</span>
                      ))}
                      {p.h_index != null && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">h:{p.h_index}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {p.next_contact_date ? (
                      <span className={`text-xs font-medium flex items-center gap-1 ${isOverdue(p.next_contact_date) ? 'text-red-600' : 'text-gray-600'}`}>
                        {isOverdue(p.next_contact_date) && <AlertTriangle className="w-3 h-3" />}
                        {formatDate(p.next_contact_date)}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[p.status] ?? 'text-gray-500 bg-gray-100'}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Kanban view */}
      {view === 'kanban' && (
        loading ? <SkeletonKanban /> :
        <PartnersKanban partners={partnerList} onRefresh={fetchPartners} />
      )}

      {/* Network view */}
      {view === 'network' && (
        <PartnerNetworkGraph partners={partnerList.map(p => ({
          ...p,
          grant_links_count: p.grant_links_count ?? 0,
        }))} />
      )}

      {/* Calendar view */}
      {view === 'calendar' && (
        <PartnerCalendar partners={partnerList.map(p => ({
          id: p.id,
          name: p.name,
          meetings: p.meetings || [],
          next_contact_date: p.next_contact_date,
        }))} />
      )}

      {/* New Partner Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">New Partner</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
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
    <Suspense fallback={<div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>}>
      <PartnersPageInner />
    </Suspense>
  );
}
