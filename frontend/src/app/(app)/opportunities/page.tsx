'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronDown, ChevronUp, AlertCircle, CheckCircle, Loader2, Clock } from 'lucide-react';
import { opportunities, sources } from '@/lib/api';
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

interface ScanRun {
  id: string;
  source_id: string;
  source_name: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  records_found: number | null;
  new_opportunities: number | null;
  duplicates: number | null;
  errors: string[];
  log_summary: string | null;
}

interface ScanSummary {
  sources_by_status: Record<string, number>;
  total_opportunities: number;
  running_scans: number;
  recent_errors_24h: number;
  last_run_at: string | null;
  last_run_status: string | null;
}

const EMPTY_FILTERS: OpportunityFilters = {
  search: '',
  priority: '',
  theme: '',
  deadlineBefore: '',
  deadlineAfter: '',
  awardMin: '',
};

const VIEW_STORAGE_KEY = 'opportunities_view_mode';
const EMPTY_GRAPH_FILTERS: GraphFilterState = { funder: '', theme: '', deadlineDays: '', minScore: '' };

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
  const [scanLogs, setScanLogs] = useState<ScanRun[]>([]);
  const [showScanLogs, setShowScanLogs] = useState(false);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
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

  useEffect(() => {
    if (activeTab === 'queue') loadQueue();
    else loadShortlist();
  }, [activeTab, loadQueue, loadShortlist]);

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
    if (graphFilters.minScore) params.min_score = graphFilters.minScore;
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

  // In focus mode, marking as read should NOT remove the card from the list —
  // that would shrink the array, change currentIndex, re-trigger mark-read,
  // and create an infinite removal cascade. Just flip is_read locally instead.
  async function handleMarkReadFocus(id: string) {
    await opportunities.markRead(id);
    markReadLocal(id);
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

  const loadScanStatus = useCallback(async () => {
    try {
      const [runsRes, summaryRes] = await Promise.all([
        sources.recentRuns(30),
        sources.summary(),
      ]);
      setScanLogs(runsRes.data || []);
      setScanSummary(summaryRes.data || null);
    } catch {
      // not critical
    }
  }, []);

  async function handleRefreshAll() {
    setRefreshing(true);
    setRefreshBanner('');
    try {
      const res = await sources.runAll();
      const count = res.data?.queued ?? '?';
      setRefreshBanner(`Scan queued for ${count} active source${count !== 1 ? 's' : ''}. New opportunities will appear in a few minutes.`);
      setShowScanLogs(true);
      // Poll scan status to show live progress
      await loadScanStatus();
      const interval = setInterval(loadScanStatus, 8000);
      setTimeout(() => {
        clearInterval(interval);
        setRefreshBanner('');
        loadQueue();
      }, 90000);
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

  async function handleShowScanLogs() {
    setShowScanLogs(v => !v);
    if (!showScanLogs) await loadScanStatus();
  }

  useEffect(() => {
    if (focusIndex >= upcoming.length && upcoming.length > 0) {
      setFocusIndex(upcoming.length - 1);
    }
  }, [upcoming.length, focusIndex]);

  const actionHandlers = {
    onToggleBookmark: handleToggleBookmark,
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
          <button onClick={() => setRefreshBanner('')} className="ml-3 text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Scan Debug Panel */}
      {showScanLogs && (
        <div className="mb-5 border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Source Scan Log</span>
              {scanSummary && (
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                    {scanSummary.sources_by_status?.active ?? 0} active
                  </span>
                  {(scanSummary.running_scans ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-blue-600">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {scanSummary.running_scans} running
                    </span>
                  )}
                  {(scanSummary.recent_errors_24h ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-red-500">
                      <AlertCircle className="w-3 h-3" />
                      {scanSummary.recent_errors_24h} errors (24h)
                    </span>
                  )}
                  <span>{scanSummary.total_opportunities?.toLocaleString()} opps in DB</span>
                </div>
              )}
            </div>
            <button onClick={() => setShowScanLogs(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {scanLogs.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">No scan runs yet. Click &quot;Refresh Sources&quot; to start.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wider">
                    <th className="text-left px-4 py-2">Source</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Found</th>
                    <th className="text-right px-4 py-2">New</th>
                    <th className="text-left px-4 py-2">Started</th>
                    <th className="text-left px-4 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {scanLogs.map(run => (
                    <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-700 max-w-[160px] truncate">{run.source_name}</td>
                      <td className="px-4 py-2">
                        {run.status === 'running' && <span className="flex items-center gap-1 text-blue-600"><Loader2 className="w-3 h-3 animate-spin" />running</span>}
                        {run.status === 'success' && <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-3 h-3" />success</span>}
                        {run.status === 'failed' && <span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3 h-3" />failed</span>}
                        {!['running','success','failed'].includes(run.status) && <span className="text-gray-400">{run.status}</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{run.records_found ?? '—'}</td>
                      <td className="px-4 py-2 text-right text-gray-700 font-medium">{run.new_opportunities ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                        {run.started_at ? new Date(run.started_at).toLocaleTimeString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-red-500 max-w-[200px] truncate" title={run.errors?.[0]}>
                        {run.errors?.[0] || run.log_summary || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
            onClick={handleShowScanLogs}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1 ${
              showScanLogs ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700'
            }`}
            title="Show scan log"
          >
            {showScanLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <Clock className="w-3.5 h-3.5" />
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
