'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { opportunities } from '@/lib/api';
import { notifyOpportunitiesChanged, onOpportunitiesChanged } from '@/lib/opportunities-events';
import OpportunityRow from '@/components/opportunities/OpportunityRow';
import OpportunityFiltersSidebar from '@/components/opportunities/OpportunityFilters';
import OpportunityGraphView, { GraphNode, GraphCluster, GraphEdge } from '@/components/opportunities/OpportunityGraphView';
import GraphFilters, { GraphFilterState } from '@/components/opportunities/GraphFilters';
import AddToShortlistModal from '@/components/opportunities/AddToShortlistModal';
import {
  isExpired,
  type Opportunity,
  type OpportunityFilters,
  type FilterOptions,
  type TabMode,
  type ViewMode,
} from '@/components/opportunities/types';

const EMPTY_FILTERS: OpportunityFilters = {
  search: '',
  priority: '',
  theme: '',
  opportunityType: '',
  geography: '',
  funder: '',
  funderCategory: '',
  sourceId: '',
  deadlineBefore: '',
  deadlineAfter: '',
  awardMin: '',
  awardMax: '',
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
  return [...filtered].sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
}

function ColHead({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-4 py-2.5 ledger-label ${className}`}
      style={{ background: 'var(--surface-sunken)' }}
    >
      {children}
    </th>
  );
}

function _buildApiParams(f: OpportunityFilters, extra: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {
    sort_by: f.sortBy === 'deadline' ? 'deadline' : f.sortBy === 'award' ? 'award_max' : 'relevance',
    ...extra,
  };
  if (f.search)          params.search = f.search;
  if (f.priority)        params.priority = f.priority;
  if (f.theme)           params.theme = f.theme;
  if (f.opportunityType) params.opportunity_type = f.opportunityType;
  if (f.geography)       params.geography = f.geography;
  if (f.funder)          params.funder = f.funder;
  if (f.funderCategory)  params.funder_category = f.funderCategory;
  if (f.sourceId)        params.source_id = f.sourceId;
  if (f.deadlineBefore)  params.deadline_before = f.deadlineBefore;
  if (f.deadlineAfter)   params.deadline_after = f.deadlineAfter;
  if (f.hasDeadline)     params.has_deadline = true;
  if (f.awardMin) { const v = parseInt(f.awardMin.replace(/,/g, ''), 10); if (!isNaN(v)) params.award_min_filter = v; }
  if (f.awardMax) { const v = parseInt(f.awardMax.replace(/,/g, ''), 10); if (!isNaN(v)) params.award_max_filter = v; }
  return params;
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabMode>('queue');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [queue, setQueue] = useState<Opportunity[]>([]);
  const [shortlist, setShortlist] = useState<Opportunity[]>([]);
  const [orgShortlist, setOrgShortlist] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queueTotal, setQueueTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<OpportunityFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphClusters, setGraphClusters] = useState<GraphCluster[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphFilters, setGraphFilters] = useState<GraphFilterState>(EMPTY_GRAPH_FILTERS);

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === 'table' || saved === 'graph') setViewMode(saved);
  }, []);

  // Load filter options once on mount
  useEffect(() => {
    opportunities.filterOptions()
      .then(r => setFilterOptions(r.data))
      .catch(() => null);
  }, []);

  const refreshCounts = useCallback(() => {
    opportunities.newOpportunitiesCounts()
      .then(r => setUnreadTotal(r.data?.unread ?? 0))
      .catch(() => null);
  }, []);

  const loadQueue = useCallback((activeFilters: OpportunityFilters, currentUnreadOnly: boolean = unreadOnly) => {
    setLoading(true);
    setPage(1);
    const params = _buildApiParams(activeFilters, { unread_only: currentUnreadOnly, page: 1, page_size: 25 });
    opportunities.list(params)
      .then(r => {
        setQueue(r.data.items ?? []);
        setQueueTotal(r.data.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    refreshCounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly, refreshCounts]);

  const loadMoreQueue = useCallback(() => {
    const nextPage = page + 1;
    setLoadingMore(true);
    const params = _buildApiParams(filters, { unread_only: unreadOnly, page: nextPage, page_size: 25 });
    opportunities.list(params)
      .then(r => {
        setQueue(prev => [...prev, ...(r.data.items ?? [])]);
        setQueueTotal(r.data.total ?? 0);
        setPage(nextPage);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  }, [unreadOnly, page, filters]);

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

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'queue') loadQueue(filters);
    else if (activeTab === 'shortlist') loadShortlist();
    else loadOrgShortlist();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Reload queue when unreadOnly toggles
  useEffect(() => {
    if (activeTab === 'queue') loadQueue(filters, unreadOnly);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  // Debounced server-side filter reload for queue tab (skip initial render)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (activeTab !== 'queue') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => loadQueue(filters), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && activeTab === 'queue') loadQueue(filters);
    };
    document.addEventListener('visibilitychange', onVisible);
    const unsub = onOpportunitiesChanged(() => {
      if (activeTab === 'queue') loadQueue(filters);
      else refreshCounts();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, refreshCounts]);

  function setView(mode: ViewMode | 'graph') {
    setViewMode(mode as ViewMode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
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

  // For queue: API already filters; for shortlist/org-shortlist: filter locally
  const items = activeTab === 'queue' ? queue : activeTab === 'shortlist' ? shortlist : orgShortlist;
  const displayItems = activeTab === 'queue' ? queue : applyFilters(items, filters);
  const upcoming = displayItems.filter(o => !isExpired(o.deadline) || !o.deadline);
  const past = displayItems.filter(o => isExpired(o.deadline));

  const hasFilters = !!(
    filters.search || filters.priority || filters.theme || filters.opportunityType ||
    filters.geography || filters.funder || filters.funderCategory || filters.sourceId ||
    filters.deadlineBefore || filters.deadlineAfter || filters.awardMin || filters.awardMax ||
    filters.hasDeadline || filters.sortBy !== 'relevance'
  );
  const unreadCount = unreadOnly ? queueTotal : unreadTotal;

  async function backfillAfterRead(removedId: string) {
    const remaining = queue.filter(o => o.id !== removedId);
    const offset = remaining.length;
    const pageSize = 25;
    const pageNum = Math.floor(offset / pageSize) + 1;
    const indexInPage = offset % pageSize;

    const r = await opportunities.list({
      sort_by: 'relevance',
      unread_only: true,
      page: pageNum,
      page_size: pageSize,
    });

    const loadedIds = new Set(remaining.map(o => o.id));
    const candidates = (r.data.items ?? []).slice(indexInPage);
    const next = candidates.find((o: Opportunity) => !loadedIds.has(o.id));

    setQueue(next ? [...remaining, next] : remaining);
    setQueueTotal(Math.max(0, (r.data.total ?? queueTotal) - 1));
    refreshCounts();
    notifyOpportunitiesChanged();
  }

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
      await backfillAfterRead(id);
    } else {
      markReadLocal(id);
      refreshCounts();
      notifyOpportunitiesChanged();
    }
  }

  async function handleToggleRead(id: string, isRead: boolean) {
    if (isRead) {
      await opportunities.markUnread(id);
      markUnreadLocal(id);
      refreshCounts();
      notifyOpportunitiesChanged();
    } else {
      await opportunities.markRead(id);
      if (unreadOnly) {
        await backfillAfterRead(id);
      } else {
        markReadLocal(id);
        refreshCounts();
        notifyOpportunitiesChanged();
      }
    }
  }

  async function handleToggleBookmark(id: string, isBookmarked: boolean) {
    if (isBookmarked) {
      await opportunities.removeFromShortlist(id);
      setQueue(prev => prev.map(o => o.id === id ? { ...o, is_personal_shortlisted: false } : o));
    } else {
      await opportunities.addToShortlist(id);
      await opportunities.markRead(id);
      setQueue(prev => prev.map(o => o.id === id ? { ...o, is_personal_shortlisted: true, is_read: true } : o));
    }
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
        onNavigate={() => {
          const ordered = [...upcoming, ...past].map(o => o.id);
          sessionStorage.setItem('opp_nav_list', JSON.stringify(ordered));
        }}
        {...actionHandlers}
      />
    ));
  }

  return (
    <div className="flex h-full" style={{ background: 'var(--surface-base)' }}>
      {/* Left filter sidebar */}
      <OpportunityFiltersSidebar
        filters={filters}
        filterOptions={filterOptions}
        onChange={setFilter}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* ── Tabs + controls ─────────────────────────── */}
        <div
          className="px-7 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-raised)' }}
        >
          <div className="flex items-center gap-0">
            {([
              { id: 'queue' as TabMode, label: 'All Opportunities', badge: unreadCount > 0 ? unreadCount.toLocaleString() : null, badgeStyle: { background: 'var(--state-info-bg)', color: 'var(--state-info)' } },
              { id: 'shortlist' as TabMode, label: 'My Shortlist', badge: shortlist.length > 0 ? String(shortlist.length) : null, badgeStyle: { background: 'var(--state-warning-bg)', color: 'var(--state-warning)' } },
              { id: 'org-shortlist' as TabMode, label: 'Org Shortlist', badge: orgShortlistCount > 0 ? String(orgShortlistCount) : null, badgeStyle: { background: 'var(--accent-secondary)', color: 'var(--accent-primary)' } },
            ] as { id: TabMode; label: string; badge: string | null; badgeStyle: React.CSSProperties }[]).map(t => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setActiveTab(t.id); }}
                  className="relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors"
                  style={{ color: active ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
                >
                  {t.label}
                  {t.badge && (
                    <span
                      className="mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                      style={t.badgeStyle}
                    >
                      {t.badge}
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: 'var(--accent-primary)' }} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 py-2.5">
            {activeTab === 'shortlist' && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--accent-primary)',
                  color: 'var(--accent-primary)',
                  background: 'transparent',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                + Add
              </button>
            )}

            {activeTab === 'queue' && (
              <>
                {/* Unread / All toggle */}
                <div
                  className="flex items-center overflow-hidden"
                  style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)' }}
                >
                  {[{ val: true, label: 'Unread' }, { val: false, label: 'All' }].map(({ val, label }) => (
                    <button
                      key={label}
                      onClick={() => setUnreadOnly(val)}
                      className="px-2.5 py-1 text-xs transition-colors"
                      style={{
                        background: unreadOnly === val ? 'var(--ink-primary)' : 'transparent',
                        color: unreadOnly === val ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* View mode toggle */}
                <div
                  className="flex items-center overflow-hidden"
                  style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)' }}
                >
                  {[
                    { val: 'table', label: 'Table' },
                    { val: 'graph', label: 'Graph' },
                  ].map(({ val, label }) => {
                    const active = viewMode === val;
                    return (
                      <button
                        key={val}
                        onClick={() => setView(val as ViewMode)}
                        className="px-2.5 py-1 text-xs transition-colors"
                        style={{
                          background: active ? 'var(--ink-primary)' : 'transparent',
                          color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Status label */}
        {!loading && (
          <div
            className="px-7 py-2 shrink-0"
            style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}
          >
            <span className="ledger-label">
              {activeTab === 'queue'
                ? `${queueTotal > queue.length ? `${queue.length} of ${queueTotal.toLocaleString()}` : queueTotal.toLocaleString()} opportunities · ${unreadCount.toLocaleString()} unread`
                : activeTab === 'shortlist'
                ? `${shortlist.length} bookmarked`
                : `${orgShortlist.length} on org shortlist`}
            </span>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-7 py-5">

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
            <div
              style={{
                border: '1px solid var(--rule-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-raised)',
              }}
            >
              <div className="px-5 py-16 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>
            </div>
          ) : (viewMode as string) === 'graph' ? (
            <div
              className="flex flex-col overflow-hidden"
              style={{
                height: 600,
                border: '1px solid var(--rule-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-raised)',
              }}
            >
              {graphLoading ? (
                <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--ink-faint)' }}>
                  Loading graph…
                </div>
              ) : (
                <OpportunityGraphView nodes={graphNodes} clusters={graphClusters} edges={graphEdges} />
              )}
            </div>
          ) : (
            <div
              className="overflow-hidden"
              style={{
                border: '1px solid var(--rule-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-raised)',
              }}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
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
              </div>

              {activeTab === 'queue' && past.length > 0 && (
                <div style={{ borderTop: '1px solid var(--rule-subtle)' }}>
                  <button
                    onClick={() => setPastExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium transition-colors"
                    style={{ color: 'var(--ink-muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
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

          {!loading && activeTab === 'queue' && (viewMode as string) !== 'graph' && queue.length < queueTotal && (
            <div className="mt-4 flex items-center justify-center">
              <button
                onClick={loadMoreQueue}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--rule-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--ink-muted)',
                  background: 'var(--surface-raised)',
                }}
              >
                {loadingMore ? 'Loading…' : `Load more (${queueTotal - queue.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddToShortlistModal
          onClose={() => setShowAddModal(false)}
          onAdded={(opp) => {
            setShortlist(prev => [opp, ...prev]);
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}
