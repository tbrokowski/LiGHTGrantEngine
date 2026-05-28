'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { opportunities } from '@/lib/api';
import OpportunityRow from '@/components/opportunities/OpportunityRow';
import FocusReview from '@/components/opportunities/FocusReview';
import OpportunityFiltersBar from '@/components/opportunities/OpportunityFilters';
import OpportunityGraphView, { GraphNode, GraphCluster, GraphEdge } from '@/components/opportunities/OpportunityGraphView';
import GraphFilters, { GraphFilterState } from '@/components/opportunities/GraphFilters';
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
  hasDeadline: false,
  sortBy: 'relevance',
};

const VIEW_STORAGE_KEY = 'opportunities_view_mode';
const EMPTY_GRAPH_FILTERS: GraphFilterState = { funder: '', theme: '', deadlineDays: '' };

const PRIORITY_GROUPS: Record<string, string[]> = {
  high: ['high', 'high_priority'],
  medium: ['medium', 'worth_reviewing'],
  low: ['low', 'low_fit', 'watchlist'],
};

function applyFilters(items: Opportunity[], filters: OpportunityFilters): Opportunity[] {
  const filtered = items.filter(o => {
    const s = filters.search.toLowerCase();
    if (s && !o.title.toLowerCase().includes(s) && !(o.funder ?? '').toLowerCase().includes(s)) return false;
    if (filters.priority) {
      const group = PRIORITY_GROUPS[filters.priority];
      if (group && !group.includes(o.priority ?? '')) return false;
    }
    if (filters.theme && !o.thematic_areas?.some(t => t.toLowerCase().includes(filters.theme.toLowerCase()))) return false;
    if (filters.deadlineAfter && o.deadline && new Date(o.deadline) < new Date(filters.deadlineAfter)) return false;
    if (filters.deadlineBefore && o.deadline && new Date(o.deadline) > new Date(filters.deadlineBefore)) return false;
    if (filters.hasDeadline && !o.deadline) return false;
    if (filters.awardMin) {
      const min = parseInt(filters.awardMin.replace(/,/g, ''), 10);
      const award = o.award_max ?? o.award_min ?? 0;
      if (!isNaN(min) && award < min) return false;
    }
    return true;
  });

  if (filters.sortBy === 'deadline') {
    return [...filtered].sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
  }
  if (filters.sortBy === 'award') {
    return [...filtered].sort((a, b) => {
      const aVal = a.award_max ?? a.award_min ?? 0;
      const bVal = b.award_max ?? b.award_min ?? 0;
      return bVal - aVal;
    });
  }
  // default: relevance — sort by fit_score descending (LLM scores encode tier already)
  return [...filtered].sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
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
  const [orgShortlist, setOrgShortlist] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<OpportunityFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [focusIndex, setFocusIndex] = useState(0);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphClusters, setGraphClusters] = useState<GraphCluster[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphFilters, setGraphFilters] = useState<GraphFilterState>(EMPTY_GRAPH_FILTERS);

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

  const loadOrgShortlist = useCallback(() => {
    setLoading(true);
    opportunities.orgShortlist()
      .then(r => setOrgShortlist(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'queue') loadQueue();
    else if (activeTab === 'shortlist') loadShortlist();
    else loadOrgShortlist();
  }, [activeTab, loadQueue, loadShortlist, loadOrgShortlist]);

  function setView(mode: ViewMode | 'graph') {
    setViewMode(mode as ViewMode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
    setFocusIndex(0);
    if (mode === 'graph') loadGraphData();
  }

  const loadGraphData = useCallback(() => {
    setGraphLoading(true);
    const params: Record<string, unknown> = {};
    if (graphFilters.funder) params.funder = graphFilters.funder;
    if (graphFilters.theme) params.theme = graphFilters.theme;
    if (graphFilters.deadlineDays) params.deadline_days = graphFilters.deadlineDays;
    opportunities.graphData(params)
      .then(r => {
        setGraphNodes(r.data.nodes || []);
        setGraphClusters(r.data.clusters || []);
        setGraphEdges(r.data.edges || []);
      })
      .catch(console.error)
      .finally(() => setGraphLoading(false));
  }, [graphFilters]);

  useEffect(() => {
    if ((viewMode as string) === 'graph') loadGraphData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFilters]);

  function setFilter<K extends keyof OpportunityFilters>(key: K, value: OpportunityFilters[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  const items = activeTab === 'queue' ? queue : activeTab === 'shortlist' ? shortlist : orgShortlist;
  const filtered = applyFilters(items, filters);
  const upcoming = filtered.filter(o => !isExpired(o.deadline) || !o.deadline);
  const past = filtered.filter(o => isExpired(o.deadline));
  const hasFilters = filters.search || filters.priority || filters.theme ||
    filters.deadlineBefore || filters.deadlineAfter || filters.awardMin ||
    filters.hasDeadline || filters.sortBy !== 'relevance';
  const unreadCount = queue.filter(o => !o.is_read).length;
  const orgShortlistCount = orgShortlist.length;

  function removeFromList(id: string) {
    if (activeTab === 'queue') setQueue(prev => prev.filter(o => o.id !== id));
    else if (activeTab === 'shortlist') setShortlist(prev => prev.filter(o => o.id !== id));
    else setOrgShortlist(prev => prev.filter(o => o.id !== id));
  }

  function markReadLocal(id: string) {
    const updater = (prev: Opportunity[]) =>
      prev.map(o => o.id === id ? { ...o, is_read: true } : o);
    setQueue(updater);
    setShortlist(updater);
    setOrgShortlist(updater);
  }

  function markUnreadLocal(id: string) {
    const updater = (prev: Opportunity[]) =>
      prev.map(o => o.id === id ? { ...o, is_read: false } : o);
    setQueue(updater);
    setShortlist(updater);
    setOrgShortlist(updater);
  }

  async function handleMarkRead(id: string) {
    await opportunities.markRead(id);
    if (unreadOnly) {
      removeFromList(id);
    } else {
      markReadLocal(id);
    }
  }

  // In focus mode, marking as read should NOT remove the card from the list —
  // that would shrink the array, change currentIndex, re-trigger mark-read,
  // and create an infinite removal cascade. Just flip is_read locally instead.
  async function handleMarkReadFocus(id: string) {
    await opportunities.markRead(id);
    markReadLocal(id);
  }

  async function handleToggleRead(id: string, isRead: boolean) {
    if (isRead) {
      await opportunities.markUnread(id);
      markUnreadLocal(id);
    } else {
      await opportunities.markRead(id);
      if (unreadOnly) {
        removeFromList(id);
      } else {
        markReadLocal(id);
      }
    }
  }

  async function handleToggleBookmark(id: string, isBookmarked: boolean) {
    if (isBookmarked) {
      await opportunities.removeFromShortlist(id);
      // also clear personal shortlist flag locally in queue
      setQueue(prev => prev.map(o => o.id === id ? { ...o, is_personal_shortlisted: false } : o));
    } else {
      await opportunities.addToShortlist(id);
      await opportunities.markRead(id);
      // reflect in queue without removing item (item stays in queue, appears in shortlist tab too)
      setQueue(prev => prev.map(o => o.id === id ? { ...o, is_personal_shortlisted: true, is_read: true } : o));
    }
    // remove from current list if we're on the shortlist/org-shortlist tabs, or if un-bookmarking
    if (activeTab !== 'queue') {
      removeFromList(id);
    }
  }

  async function handlePromoteToOrg(id: string, isOnOrg: boolean) {
    if (isOnOrg) {
      await opportunities.removeFromOrgShortlist(id);
      const updater = (prev: Opportunity[]) =>
        prev.map(o => o.id === id ? { ...o, is_on_org_shortlist: false } : o);
      setShortlist(updater);
      setOrgShortlist(prev => prev.filter(o => o.id !== id));
    } else {
      await opportunities.promoteToOrgShortlist(id);
      const updater = (prev: Opportunity[]) =>
        prev.map(o => o.id === id ? { ...o, is_on_org_shortlist: true } : o);
      setShortlist(updater);
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

  useEffect(() => {
    if (focusIndex >= upcoming.length && upcoming.length > 0) {
      setFocusIndex(upcoming.length - 1);
    }
  }, [upcoming.length, focusIndex]);

  const actionHandlers = {
    onToggleBookmark: handleToggleBookmark,
    onToggleRead: handleToggleRead,
    onPromoteToOrg: handlePromoteToOrg,
    onStartGrant: handleStartGrant,
  };

  function renderTableBody(listItems: Opportunity[]) {
    if (listItems.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">
            {hasFilters
            ? 'No matches for current filters.'
            : activeTab === 'queue'
            ? 'Queue is empty.'
            : activeTab === 'shortlist'
            ? 'Your shortlist is empty. Bookmark opportunities from the queue to add them here.'
            : 'No opportunities on the org shortlist yet. Promote items from your personal shortlist.'}
          </td>
        </tr>
      );
    }
    const rowMode = activeTab === 'org-shortlist' ? 'org-shortlist' : activeTab === 'shortlist' ? 'shortlist' : 'queue';
    return listItems.map((opp, i) => (
      <OpportunityRow
        key={opp.id}
        opp={opp}
        index={i}
        mode={rowMode}
        {...actionHandlers}
      />
    ));
  }

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Opportunities</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Loading…' : activeTab === 'queue'
              ? `${queue.length} in queue · ${unreadCount} unread · ${upcoming.length} upcoming`
              : activeTab === 'shortlist'
              ? `${shortlist.length} bookmarked`
              : `${orgShortlist.length} on org shortlist`}
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
        </div>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center justify-between mb-5 border-b border-gray-200">
        <div className="flex gap-0">
          <button
            onClick={() => { setActiveTab('queue'); setFocusIndex(0); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'queue'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Review Queue
            {unreadCount > 0 && (
              <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{unreadCount}</span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('shortlist'); setFocusIndex(0); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'shortlist'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            My Shortlist
            {shortlist.length > 0 && (
              <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{shortlist.length}</span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('org-shortlist'); setFocusIndex(0); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'org-shortlist'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Org Shortlist
            {orgShortlistCount > 0 && (
              <span className="ml-1.5 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">{orgShortlistCount}</span>
            )}
          </button>
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
              <button
                onClick={() => setView('graph' as ViewMode)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  (viewMode as string) === 'graph' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
                title="Graph view"
              >
                Graph
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

      {/* Graph filter bar */}
      {(viewMode as string) === 'graph' && (
        <div className="mb-4">
          <GraphFilters
            filters={graphFilters}
            onChange={setGraphFilters}
            funders={[...new Set(graphNodes.map(n => n.funder).filter(Boolean) as string[])].slice(0, 20)}
            themes={[...new Set(graphNodes.flatMap(n => n.thematic_areas))].slice(0, 20)}
          />
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-16 text-center text-sm text-gray-400">Loading…</div>
        </div>
      ) : (viewMode as string) === 'graph' ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col" style={{ height: 600 }}>
          {graphLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading graph…</div>
          ) : (
            <OpportunityGraphView nodes={graphNodes} clusters={graphClusters} edges={graphEdges} />
          )}
        </div>
      ) : activeTab === 'queue' && viewMode === 'focus' ? (
        <FocusReview
          items={upcoming}
          currentIndex={focusIndex}
          onIndexChange={setFocusIndex}
          onMarkRead={handleMarkReadFocus}
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
