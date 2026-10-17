'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { analytics, grants, tasks as tasksApi } from '@/lib/api';
import { onOpportunitiesChanged } from '@/lib/opportunities-events';
import { useAuth } from '@/lib/auth';
import FocusPanel, { type GrantItem, type TaskItem } from '@/components/dashboard/FocusPanel';
import Scratchpad from '@/components/dashboard/Scratchpad';
import GrantTimeline from '@/components/dashboard/GrantTimeline';
import DailyPicks from '@/components/dashboard/DailyPicks';
import InboxWidget from '@/components/dashboard/InboxWidget';

interface DashboardStats {
  new_opportunities_this_week: number;
  high_fit_pending_review: number;
  proposals_in_development: number;
  active_grants: number;
  grants_due_within_30_days: number;
  tasks_due_this_week: number;
  archived_grants: number;
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

export default function DashboardPage() {
  const { user } = useAuth();
  const pathname = usePathname();
  const userName = user?.name ?? null;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [grantList, setGrantList] = useState<GrantItem[]>([]);
  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [allTaskList, setAllTaskList] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const loadDashboard = useCallback(() => {
    setLoading(true);
    Promise.all([
      analytics.dashboard().catch(() => ({ data: null })),
      grants.list({ limit: 50 }).catch(() => ({ data: [] })),
      tasksApi.myTasks().catch(() => ({ data: [] })),
      tasksApi.all().catch(() => ({ data: [] })),
    ]).then(([statsRes, grantsRes, tasksRes, allTasksRes]) => {
      setStats(statsRes.data);
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
    // Refresh when opportunities change (read/save/scan), but NOT on every tab
    // focus — reloading the heavy endpoints on each visibility change was a
    // major source of dashboard slowness.
    const unsub = onOpportunitiesChanged(loadDashboard);
    return () => { unsub(); };
  }, [loadDashboard]);

  const tasksDue = stats?.tasks_due_this_week ?? 0;

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--surface-base)' }}
    >

      {/* ── Page header ─────────────────────────────────────── */}
      <div
        className="px-8 pt-6 pb-5 flex flex-wrap items-end justify-between gap-4 shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      >
        <div>
          <p className="ledger-label mb-1.5" style={{ color: 'var(--panel-header-text)', opacity: 0.6 }}>{todayLabel()}</p>
          <h1
            className="font-semibold tracking-tight"
            style={{ fontSize: '22px', color: 'var(--ink-primary)', letterSpacing: '-0.02em' }}
          >
            {greeting(userName)}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/grants"
            className="flex items-baseline gap-2 transition-opacity hover:opacity-80"
            title="Tasks due in the next 7 days"
          >
            <span className="ledger-label">Tasks due this week</span>
            <span
              className="mono-data font-semibold"
              style={{
                fontSize: '18px',
                lineHeight: 1,
                color: !loading && tasksDue > 0 ? 'var(--state-warning)' : 'var(--ink-primary)',
              }}
            >
              {loading ? '–' : tasksDue}
            </span>
          </Link>
          <InboxWidget />
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Row 1 — Today's opportunities, refreshed daily */}
        <div className="p-5 pb-0">
          <DailyPicks />
        </div>

        {/* Row 2 — Focus + Scratchpad side by side */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 p-5">
          <FocusPanel grants={grantList} myTasks={taskList} allTasks={allTaskList} loading={loading} currentUserId={user?.id ?? null} />
          <Scratchpad />
        </div>

        {/* Row 3 — Grant Timeline full width */}
        <div className="px-5 pb-5">
          <GrantTimeline grants={grantList} loading={loading} starredIds={starredIds} tasks={allTaskList} />
        </div>

      </div>

    </div>
  );
}
