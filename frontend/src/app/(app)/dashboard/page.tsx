'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { analytics, opportunities, grants, tasks as tasksApi } from '@/lib/api';
import { onOpportunitiesChanged } from '@/lib/opportunities-events';
import { useAuth } from '@/lib/auth';
import FocusPanel, { type GrantItem, type TaskItem } from '@/components/dashboard/FocusPanel';
import Scratchpad from '@/components/dashboard/Scratchpad';
import GrantTimeline from '@/components/dashboard/GrantTimeline';

interface DashboardStats {
  new_opportunities_this_week: number;
  high_fit_pending_review: number;
  active_grants: number;
  grants_due_within_30_days: number;
  overdue_tasks: number;
  archived_grants: number;
}

interface QueueItem {
  id: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  fit_score: number | null;
  priority: string | null;
  is_read?: boolean;
}

const PRIORITY_COLOR: Record<string, { bg: string; color: string }> = {
  high:          { bg: 'var(--state-success-bg)',  color: 'var(--state-success)' },
  medium:        { bg: 'var(--state-warning-bg)',  color: 'var(--state-warning)' },
  low:           { bg: 'var(--surface-sunken)',    color: 'var(--ink-muted)' },
  high_priority: { bg: 'var(--state-success-bg)',  color: 'var(--state-success)' },
  worth_reviewing:{ bg: 'var(--state-warning-bg)', color: 'var(--state-warning)' },
  watchlist:     { bg: 'var(--state-info-bg)',     color: 'var(--state-info)' },
  low_fit:       { bg: 'var(--surface-sunken)',    color: 'var(--ink-muted)' },
};

const PRIORITY_LABEL: Record<string, string> = {
  high: 'High Fit', medium: 'Medium Fit', low: 'Low Fit',
  high_priority: 'High Fit', worth_reviewing: 'Medium Fit',
  watchlist: 'Low Fit', low_fit: 'Low Fit',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return d; }
}

function greeting(name?: string | null) {
  const h = new Date().getHours();
  const base = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.split(' ')[0];
  return firstName ? `${base}, ${firstName}` : base;
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function loadStarredIds(): Set<string> {
  try {
    const raw = localStorage.getItem('dashboard_starred');
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

interface StatMetric {
  label: string;
  value: number;
  href: string;
  alert?: boolean;
  warn?: boolean;
}

function MetricCell({ metric, loading }: { metric?: StatMetric; loading: boolean }) {
  if (loading) {
    return (
      <div className="px-8 py-4">
        <div className="h-2 w-20 rounded animate-pulse mb-3" style={{ background: 'var(--rule-subtle)' }} />
        <div className="h-6 w-10 rounded animate-pulse" style={{ background: 'var(--rule-subtle)' }} />
      </div>
    );
  }
  if (!metric) return null;

  const isAlert = metric.alert && metric.value > 0;
  const isWarn = metric.warn && metric.value > 0;

  const valueColor = isAlert
    ? 'var(--state-danger)'
    : isWarn
    ? 'var(--state-warning)'
    : 'var(--ink-primary)';

  return (
    <Link
      href={metric.href}
      className="flex flex-col px-6 py-4 transition-colors duration-100 hover:bg-[var(--selection-bg)]"
    >
      <p className="ledger-label mb-2">{metric.label}</p>
      <p
        className="mono-data font-semibold"
        style={{ fontSize: '22px', lineHeight: 1, color: valueColor }}
      >
        {metric.value}
      </p>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const pathname = usePathname();
  const userName = user?.name ?? null;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [grantList, setGrantList] = useState<GrantItem[]>([]);
  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [allTaskList, setAllTaskList] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const loadDashboard = useCallback(() => {
    setLoading(true);
    Promise.all([
      analytics.dashboard().catch(() => ({ data: null })),
      opportunities.newOpportunities({ unread_only: true, limit: 10 }).catch(() => ({ data: { items: [] } })),
      grants.list({ limit: 50 }).catch(() => ({ data: [] })),
      tasksApi.myTasks().catch(() => ({ data: [] })),
      tasksApi.all().catch(() => ({ data: [] })),
    ]).then(([statsRes, queueRes, grantsRes, tasksRes, allTasksRes]) => {
      setStats(statsRes.data);
      setQueue((queueRes.data?.items ?? []) as QueueItem[]);
      setGrantList(grantsRes.data as GrantItem[]);
      setTaskList(tasksRes.data as TaskItem[]);
      setAllTaskList(allTasksRes.data as TaskItem[]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setStarredIds(loadStarredIds());
    const onStorage = () => setStarredIds(loadStarredIds());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard, pathname]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadDashboard(); };
    document.addEventListener('visibilitychange', onVisible);
    const unsub = onOpportunitiesChanged(loadDashboard);
    return () => { document.removeEventListener('visibilitychange', onVisible); unsub(); };
  }, [loadDashboard]);

  const metrics: StatMetric[] = stats ? [
    {
      label: 'Pending Review',
      value: stats.high_fit_pending_review,
      href: '/opportunities',
      warn: stats.high_fit_pending_review > 0,
    },
    {
      label: 'Active Grants',
      value: stats.active_grants,
      href: '/grants',
    },
    {
      label: 'Due in 30 Days',
      value: stats.grants_due_within_30_days,
      href: '/grants',
      warn: stats.grants_due_within_30_days > 0,
    },
    {
      label: 'Overdue Tasks',
      value: stats.overdue_tasks,
      href: '/grants',
      alert: stats.overdue_tasks > 0,
    },
  ] : [];

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--surface-base)' }}
    >

      {/* ── Page header ─────────────────────────────────────── */}
      <div
        className="px-8 pt-6 pb-5"
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      >
        <p className="ledger-label mb-1.5" style={{ color: 'var(--panel-header-text)', opacity: 0.6 }}>{todayLabel()}</p>
        <h1
          className="font-semibold tracking-tight"
          style={{ fontSize: '22px', color: 'var(--ink-primary)', letterSpacing: '-0.02em' }}
        >
          {greeting(userName)}
        </h1>
      </div>

      {/* ── Metric strip ────────────────────────────────────── */}
      <div
        className="flex justify-center shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      >
        {loading
          ? [0,1,2,3].map(i => (
              <div key={i} style={{ width: '180px' }}>
                <MetricCell loading={true} />
              </div>
            ))
          : metrics.map(m => (
              <div key={m.label} style={{ width: '180px' }}>
                <MetricCell metric={m} loading={false} />
              </div>
            ))
        }
      </div>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Row 1 — Focus + Scratchpad side by side */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 p-5">
          <FocusPanel grants={grantList} tasks={taskList} loading={loading} currentUserId={user?.id ?? null} />
          <Scratchpad />
        </div>

        {/* Row 2 — Grant Timeline full width */}
        <div className="px-5 pb-5">
          <GrantTimeline grants={grantList} loading={loading} starredIds={starredIds} tasks={allTaskList} />
        </div>

        {/* Row 3 — New Opportunities full width */}
        <div className="px-5 pb-5">
          <div
            className="overflow-hidden"
            style={{
              border: '1px solid var(--rule-subtle)',
              borderRadius: 'var(--radius-lg)',
              minHeight: '288px',
            }}
          >
            {/* Card header */}
            <div
              className="px-5 py-3.5 flex items-center justify-between shrink-0"
              style={{
                background: 'var(--panel-header-bg)',
                borderBottom: '1px solid var(--panel-header-rule)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="text-sm font-semibold"
                  style={{ color: 'var(--panel-header-text)' }}
                >
                  New Opportunities
                </span>
                {!loading && stats && stats.new_opportunities_this_week > 0 && (
                  <span
                    className="mono-data text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                    style={{ background: 'rgba(28,60,114,0.12)', color: 'var(--panel-header-text)' }}
                  >
                    {stats.new_opportunities_this_week} this week
                  </span>
                )}
              </div>
              <Link
                href="/opportunities"
                className="transition-colors"
                style={{ color: 'var(--ink-faint)', fontSize: '11px' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
              >
                View all →
              </Link>
            </div>

            {/* Queue list — 2-col grid when full-width */}
            <div>
              {loading ? (
                <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>
                  Loading…
                </div>
              ) : queue.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>All caught up</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>No new opportunities to review</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2">
                  {queue.map(opp => {
                    const pc = opp.priority ? (PRIORITY_COLOR[opp.priority] ?? PRIORITY_COLOR.low) : null;
                    return (
                      <Link key={opp.id} href={`/opportunities/${opp.id}`}>
                        <div className="ledger-row px-5 py-3 flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 flex items-start gap-2">
                            {!opp.is_read && (
                              <span
                                className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: 'var(--accent-primary)' }}
                              />
                            )}
                            <div className="min-w-0">
                              <p
                                className="text-sm truncate leading-snug"
                                style={{
                                  fontWeight: opp.is_read ? 400 : 500,
                                  color: opp.is_read ? 'var(--ink-muted)' : 'var(--ink-primary)',
                                }}
                              >
                                {opp.title}
                              </p>
                              <p
                                className="mono-data text-[11px] mt-0.5 truncate"
                                style={{ color: 'var(--ink-faint)' }}
                              >
                                {[opp.funder, opp.deadline ? formatDate(opp.deadline) : null]
                                  .filter(Boolean).join('  ·  ')}
                              </p>
                            </div>
                          </div>
                          {pc && opp.priority && (
                            <span
                              className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)] mono-data"
                              style={{ background: pc.bg, color: pc.color }}
                            >
                              {PRIORITY_LABEL[opp.priority] ?? opp.priority}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
