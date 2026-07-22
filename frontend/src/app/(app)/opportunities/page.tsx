'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { opportunities, organizations } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notifyOpportunitiesChanged, onOpportunitiesChanged } from '@/lib/opportunities-events';
import OpportunityRow from '@/components/opportunities/OpportunityRow';
import OpportunityFiltersSidebar from '@/components/opportunities/OpportunityFilters';
import OpportunityGraphView, { GraphNode, GraphCluster, GraphEdge } from '@/components/opportunities/OpportunityGraphView';
import AddToShortlistModal from '@/components/opportunities/AddToShortlistModal';
import ShortlistCardRows from '@/components/opportunities/ShortlistCardRows';
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
  priorityFunderGroup: '',
  sourceId: '',
  funderOrgId: '',
  deadlineBefore: '',
  deadlineAfter: '',
  awardMin: '',
  awardMax: '',
  hasDeadline: false,
  sortBy: 'relevance',
};

const VIEW_STORAGE_KEY = 'opportunities_view_mode';

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
  if (f.priorityFunderGroup) params.priority_funder_group = f.priorityFunderGroup;
  if (f.sourceId)        params.source_id = f.sourceId;
  if (f.funderOrgId)     params.funder_org_id = f.funderOrgId;
  if (f.deadlineBefore)  params.deadline_before = f.deadlineBefore;
  if (f.deadlineAfter)   params.deadline_after = f.deadlineAfter;
  if (f.hasDeadline)     params.has_deadline = true;
  if (f.awardMin) { const v = parseInt(f.awardMin.replace(/,/g, ''), 10); if (!isNaN(v)) params.award_min_filter = v; }
  if (f.awardMax) { const v = parseInt(f.awardMax.replace(/,/g, ''), 10); if (!isNaN(v)) params.award_max_filter = v; }
  return params;
}

export default function OpportunitiesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [priorityFunderGroups, setPriorityFunderGroups] = useState<{ name: string; funders: string[] }[]>([]);
  const [activeTab, setActiveTab] = useState<TabMode>('queue');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [queue, setQueue] = useState<Opportunity[]>([]);
  const [shortlist, setShortlist] = useState<Opportunity[]>([]);
  const [orgShortlist, setOrgShortlist] = useState<Opportunity[]>([]);
  const [awarded, setAwarded] = useState<Opportunity[]>([]);
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

  // Load priority funder groups from the org's grant profile (per-institution,
  // so fetched directly rather than via the shared filter-options cache).
  useEffect(() => {
    if (!user?.institution_id) return;
    organizations.getGrantProfile(user.institution_id)
      .then(r => setPriorityFunderGroups(r.data?.priority_funders ?? []))
      .catch(() => setPriorityFunderGroups([]));
  }, [user?.institution_id]);

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

  const loadShortlist = useCallback((activeFilters: OpportunityFilters) => {
    setLoading(true);
    opportunities.shortlist(_buildApiParams(activeFilters))
      .then(r => setShortlist(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadOrgShortlist = useCallback((activeFilters: OpportunityFilters) => {
    setLoading(true);
    opportunities.orgShortlist(_buildApiParams(activeFilters))
      .then(r => setOrgShortlist(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadAwarded = useCallback((activeFilters: OpportunityFilters) => {
    setLoading(true);
    opportunities.awarded(_buildApiParams(activeFilters))
      .then(r => setAwarded(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Plain function (not useCallback) so it always closes over the latest
  // loadQueue/loadShortlist/etc. (which themselves depend on unreadOnly, etc).
  function loadForActiveTab(tab: TabMode, activeFilters: OpportunityFilters) {
    if (tab === 'queue') loadQueue(activeFilters);
    else if (tab === 'shortlist') loadShortlist(activeFilters);
    else if (tab === 'org-shortlist') loadOrgShortlist(activeFilters);
    else loadAwarded(activeFilters);
  }

  // Load data when tab changes
  useEffect(() => {
    loadForActiveTab(activeTab, filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Reload queue when unreadOnly toggles
  useEffect(() => {
    if (activeTab === 'queue') loadQueue(filters, unreadOnly);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  // Debounced server-side filter reload — applies to whichever tab is active
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => loadForActiveTab(activeTab, filters), 300);
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
    if (mode === 'graph') loadGraphData(filters);
  }

  // Graph view now shares the same sidebar OpportunityFilters as the table,
  // instead of its own narrower funder/theme/deadline_days-only filter bar.
  const loadGraphData = useCallback((activeFilters: OpportunityFilters) => {
    setGraphLoading(true);
    opportunities.graphData(_buildApiParams(activeFilters))
      .then(r => {
        setGraphNodes(r.data.nodes || []);
        setGraphClusters(r.data.clusters || []);
        setGraphEdges(r.data.edges || []);
      })
      .catch(console.error)
      .finally(() => setGraphLoading(false));
  }, []);

  // Reload the graph when filters change while already in graph mode
  // (switching *into* graph mode is handled by setView() below).
  useEffect(() => {
    if ((viewMode as string) === 'graph') loadGraphData(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function setFilter<K extends keyof OpportunityFilters>(key: K, value: OpportunityFilters[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  // All tabs now apply filters server-side.
  const displayItems = activeTab === 'queue' ? queue
    : activeTab === 'shortlist' ? shortlist
    : activeTab === 'org-shortlist' ? orgShortlist
    : awarded;
  const upcoming = displayItems.filter(o => !isExpired(o.deadline) || !o.deadline);
  const past = displayItems.filter(o => isExpired(o.deadline));

  useEffect(() => {
    if (!loading && upcoming.length === 0 && past.length > 0) {
      setPastExpanded(true);
    }
  }, [loading, upcoming.length, past.length]);

  const hasFilters = !!(
    filters.search || filters.priority || filters.theme || filters.opportunityType ||
    filters.geography || filters.funder || filters.funderCategory || filters.priorityFunderGroup || filters.sourceId ||
    filters.funderOrgId ||
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
    else if (activeTab === 'org-shortlist') setOrgShortlist(prev => prev.filter(o => o.id !== id));
    else setAwarded(prev => prev.filter(o => o.id !== id));
  }

  function markReadLocal(id: string) {
    const updater = (prev: Opportunity[]) =>
      prev.map(o => o.id === id ? { ...o, is_read: true } : o);
    setQueue(updater);
    setShortlist(updater);
    setOrgShortlist(updater);
    setAwarded(updater);
  }

  function markUnreadLocal(id: string) {
    const updater = (prev: Opportunity[]) =>
      prev.map(o => o.id === id ? { ...o, is_read: false } : o);
    setQueue(updater);
    setShortlist(updater);
    setOrgShortlist(updater);
    setAwarded(updater);
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
          <td colSpan={5} className="px-5 py-12 text-center text-sm text-gray-400">
            {hasFilters
            ? 'No matches for current filters.'
            : activeTab === 'queue'
            ? (past.length > 0 ? 'No upcoming opportunities.' : 'Queue is empty.')
            : activeTab === 'shortlist'
            ? 'Your shortlist is empty. Bookmark opportunities from the queue to add them here.'
            : activeTab === 'org-shortlist'
            ? 'No opportunities on the org shortlist yet. Promote items from your personal shortlist.'
            : 'No awarded opportunities recorded yet. Mark an outcome from an opportunity’s detail page.'}
          </td>
        </tr>
      );
    }
    const rowMode = activeTab === 'org-shortlist' ? 'org-shortlist'
      : activeTab === 'shortlist' ? 'shortlist'
      : activeTab === 'awarded' ? 'awarded'
      : 'queue';
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
        priorityFunderGroups={priorityFunderGroups}
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
          <div
            className="flex items-center overflow-hidden my-2.5"
            style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)' }}
          >
            {([
              { id: 'queue' as TabMode, label: 'All Opportunities', badge: unreadCount > 0 ? unreadCount.toLocaleString() : null },
              { id: 'shortlist' as TabMode, label: 'My Shortlist', badge: shortlist.length > 0 ? String(shortlist.length) : null },
              { id: 'org-shortlist' as TabMode, label: 'Org Shortlist', badge: orgShortlistCount > 0 ? String(orgShortlistCount) : null },
              { id: 'awarded' as TabMode, label: 'Awarded', badge: awarded.length > 0 ? String(awarded.length) : null },
            ] as { id: TabMode; label: string; badge: string | null }[]).map(t => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setActiveTab(t.id); }}
                  className="flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    background: active ? 'var(--ink-primary)' : 'transparent',
                    color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                  }}
                >
                  {t.label}
                  {t.badge && (
                    <span
                      className="mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                      style={{
                        background: active ? 'rgba(255,255,255,0.18)' : 'var(--surface-sunken)',
                        color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                      }}
                    >
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 py-2.5">
            {(activeTab === 'shortlist' || activeTab === 'queue') && (
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
                {activeTab === 'queue' ? '+ Add Opportunity' : '+ Add'}
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-7 py-5">

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
          ) : (activeTab === 'shortlist' || activeTab === 'org-shortlist') ? (
            <ShortlistCardRows
              items={displayItems}
              mode={activeTab}
              priorityFunderGroups={priorityFunderGroups}
              funderOrgs={filterOptions?.funder_orgs}
              onNavigate={id => {
                const ordered = displayItems.map(o => o.id);
                sessionStorage.setItem('opp_nav_list', JSON.stringify(ordered));
              }}
              {...actionHandlers}
            />
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
                      <ColHead className="w-12">
                        <span className="sr-only">Read status</span>
                      </ColHead>
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
          addToShortlist={activeTab === 'shortlist'}
          onClose={() => setShowAddModal(false)}
          onAdded={(opp) => {
            if (activeTab === 'queue') {
              setQueue(prev => [opp, ...prev]);
              setQueueTotal(prev => prev + 1);
            } else {
              setShortlist(prev => [opp, ...prev]);
            }
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}
