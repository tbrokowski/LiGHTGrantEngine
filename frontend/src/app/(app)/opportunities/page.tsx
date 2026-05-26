'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { opportunities, sources } from '@/lib/api';
import OpportunityRow from '@/components/opportunities/OpportunityRow';
import FocusReview from '@/components/opportunities/FocusReview';
import OpportunityFiltersBar from '@/components/opportunities/OpportunityFilters';
import {
  isExpired,
  type Opportunity,
  type OpportunityFilters,
  type TabMode,
  type ViewMode,
} from '@/components/opportunities/types';

const EMPTY_FILTERS: OpportunityFilters = {
  search: '',
  priority: '',
  theme: '',
  deadlineBefore: '',
  deadlineAfter: '',
  awardMin: '',
};

const VIEW_STORAGE_KEY = 'opportunities_view_mode';

function applyFilters(items: Opportunity[], filters: OpportunityFilters) {
  return items.filter(o => {
    const s = filters.search.toLowerCase();
    if (s && !o.title.toLowerCase().includes(s) && !(o.funder ?? '').toLowerCase().includes(s)) return false;
    if (filters.priority && o.priority !== filters.priority) return false;
    if (filters.theme && !o.thematic_areas?.some(t => t.toLowerCase().includes(filters.theme.toLowerCase()))) return false;
    if (filters.deadlineAfter && o.deadline && new Date(o.deadline) < new Date(filters.deadlineAfter)) return false;
    if (filters.deadlineBefore && o.deadline && new Date(o.deadline) > new Date(filters.deadlineBefore)) return false;
    if (filters.awardMin) {
      const min = parseInt(filters.awardMin.replace(/,/g, ''), 10);
      const award = o.award_max ?? o.award_min ?? 0;
      if (!isNaN(min) && award < min) return false;
    }
    return true;
  });
}

function ColHead({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider ${className}`}>
      {children}
    </th>
  );
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabMode>('queue');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [queue, setQueue] = useState<Opportunity[]>([]);
  const [shortlist, setShortlist] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshBanner, setRefreshBanner] = useState('');
  const [filters, setFilters] = useState<OpportunityFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === 'table' || saved === 'focus') setViewMode(saved);
  }, []);

  const loadQueue = useCallback(() => {
    setLoading(true);
    opportunities.queue({ unread_only: unreadOnly })
      .then(r => setQueue(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [unreadOnly]);

  const loadShortlist = useCallback(() => {
    setLoading(true);
    opportunities.shortlist()
      .then(r => setShortlist(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'queue') loadQueue();
    else loadShortlist();
  }, [activeTab, loadQueue, loadShortlist]);

  function setView(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
    setFocusIndex(0);
  }

  function setFilter<K extends keyof OpportunityFilters>(key: K, value: OpportunityFilters[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  const items = activeTab === 'queue' ? queue : shortlist;
  const filtered = applyFilters(items, filters);
  const upcoming = filtered.filter(o => !isExpired(o.deadline) || !o.deadline);
  const past = filtered.filter(o => isExpired(o.deadline));
  const hasFilters = filters.search || filters.priority || filters.theme ||
    filters.deadlineBefore || filters.deadlineAfter || filters.awardMin;
  const unreadCount = queue.filter(o => !o.is_read).length;

  function removeFromList(id: string) {
    if (activeTab === 'queue') setQueue(prev => prev.filter(o => o.id !== id));
    else setShortlist(prev => prev.filter(o => o.id !== id));
  }

  function markReadLocal(id: string) {
    const updater = (prev: Opportunity[]) =>
      prev.map(o => o.id === id ? { ...o, is_read: true } : o);
    setQueue(updater);
    setShortlist(updater);
  }

  async function handleMarkRead(id: string) {
    await opportunities.markRead(id);
    if (unreadOnly) {
      removeFromList(id);
    } else {
      markReadLocal(id);
    }
  }

  async function handleToggleBookmark(id: string, isBookmarked: boolean) {
    if (isBookmarked) {
      await opportunities.removeFromShortlist(id);
    } else {
      await opportunities.update(id, { status: 'potential_fit' });
      await opportunities.markRead(id);
    }
    if (activeTab === 'queue' || isBookmarked) {
      removeFromList(id);
    } else {
      markReadLocal(id);
    }
  }

  async function handleStartGrant(id: string) {
    if (!confirm('Start a grant workspace for this opportunity?')) return;
    try {
      const res = await opportunities.convertToGrant(id);
      router.push(`/grants/${res.data.grant_id}`);
    } catch {
      alert('Failed to start grant workspace. Please try again.');
    }
  }

  async function handleRefreshAll() {
    setRefreshing(true);
    setRefreshBanner('');
    try {
      const res = await sources.runAll();
      const count = res.data?.queued ?? '?';
      setRefreshBanner(`Scan queued for ${count} active source${count !== 1 ? 's' : ''}. New opportunities will appear shortly.`);
      setTimeout(() => setRefreshBanner(''), 8000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setRefreshBanner('Admin access required to trigger source scans.');
      } else {
        setRefreshBanner('Failed to trigger scan. Check that the backend is running.');
      }
      setTimeout(() => setRefreshBanner(''), 5000);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (focusIndex >= upcoming.length && upcoming.length > 0) {
      setFocusIndex(upcoming.length - 1);
    }
  }, [upcoming.length, focusIndex]);

  const actionHandlers = {
    onToggleBookmark: handleToggleBookmark,
    onStartGrant: handleStartGrant,
  };

  function renderTableBody(listItems: Opportunity[]) {
    if (listItems.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">
            {hasFilters ? 'No matches for current filters.' : activeTab === 'queue' ? 'Queue is empty.' : 'Shortlist is empty.'}
          </td>
        </tr>
      );
    }
    return listItems.map((opp, i) => (
      <OpportunityRow
        key={opp.id}
        opp={opp}
        index={i}
        mode={activeTab}
        {...actionHandlers}
      />
    ));
  }

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {refreshBanner && (
        <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 flex items-center justify-between">
          <span>{refreshBanner}</span>
          <button onClick={() => setRefreshBanner('')} className="ml-3 text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Opportunities</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Loading…' : activeTab === 'queue'
              ? `${queue.length} in queue · ${unreadCount} unread · ${upcoming.length} upcoming`
              : `${shortlist.length} shortlisted`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search…"
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
          />
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              showFilters || hasFilters
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700'
            }`}
          >
            Filters {hasFilters ? '·' : ''}
          </button>
          <button
            onClick={handleRefreshAll}
            disabled={refreshing}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? 'Scanning…' : 'Refresh Sources'}
          </button>
        </div>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center justify-between mb-5 border-b border-gray-200">
        <div className="flex gap-0">
          {(['queue', 'shortlist'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setFocusIndex(0); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab === 'queue' ? 'Review Queue' : 'Shortlist'}
              {tab === 'queue' && unreadCount > 0 && (
                <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{unreadCount}</span>
              )}
              {tab === 'shortlist' && shortlist.length > 0 && (
                <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{shortlist.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          {activeTab === 'queue' && (
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => setUnreadOnly(true)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  unreadOnly ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Unread
              </button>
              <button
                onClick={() => setUnreadOnly(false)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  !unreadOnly ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                All
              </button>
            </div>
          )}
          {activeTab === 'queue' && (
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setView('table')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'table' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
                title="Table view"
              >
                Table
              </button>
              <button
                onClick={() => setView('focus')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'focus' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
                title="Focus view"
              >
                Focus
              </button>
            </div>
          )}
        </div>
      </div>

      <OpportunityFiltersBar
        filters={filters}
        onChange={setFilter}
        onClear={() => setFilters(EMPTY_FILTERS)}
        show={showFilters}
      />

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-16 text-center text-sm text-gray-400">Loading…</div>
        </div>
      ) : activeTab === 'queue' && viewMode === 'focus' ? (
        <FocusReview
          items={upcoming}
          currentIndex={focusIndex}
          onIndexChange={setFocusIndex}
          onMarkRead={handleMarkRead}
          onToggleBookmark={handleToggleBookmark}
          onStartGrant={handleStartGrant}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <ColHead className="pl-5">Title</ColHead>
                <ColHead className="hidden md:table-cell">Funder</ColHead>
                <ColHead className="hidden lg:table-cell">Deadline</ColHead>
                <ColHead className="hidden lg:table-cell text-right">Award</ColHead>
                <ColHead className="text-center">Score</ColHead>
                <ColHead>Actions</ColHead>
              </tr>
            </thead>
            <tbody>
              {renderTableBody(upcoming)}
            </tbody>
          </table>

          {activeTab === 'queue' && past.length > 0 && (
            <div className="border-t border-gray-100">
              <button
                onClick={() => setPastExpanded(v => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <span>Past deadline · {past.length}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${pastExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pastExpanded && (
                <table className="w-full text-sm">
                  <tbody>{renderTableBody(past)}</tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
