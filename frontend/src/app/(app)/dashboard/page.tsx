'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { analytics, opportunities, grants } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import FocusPanel, { type GrantItem } from '@/components/dashboard/FocusPanel';
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

const PRIORITY_COLOR: Record<string, string> = {
  high_priority: 'bg-red-100 text-red-600',
  worth_reviewing: 'bg-amber-100 text-amber-600',
  watchlist: 'bg-sky-100 text-sky-600',
  low_fit: 'bg-gray-100 text-gray-400',
};

const PRIORITY_LABEL: Record<string, string> = {
  high_priority: 'High',
  worth_reviewing: 'Worth Reviewing',
  watchlist: 'Watchlist',
  low_fit: 'Low Fit',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
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

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-1.5" title={`Fit score: ${Math.round(pct)}`}>
      <div className="w-10 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-gray-400 tabular-nums w-5 text-right">{Math.round(pct)}</span>
    </div>
  );
}

function loadStarredIds(): Set<string> {
  try {
    const raw = localStorage.getItem('dashboard_starred');
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

export default function DashboardPage() {
  const { user } = useAuth();
  const userName = user?.name ?? null;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [grantList, setGrantList] = useState<GrantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setStarredIds(loadStarredIds());

    // Re-sync stars when localStorage changes (e.g. user stars something in FocusPanel)
    const onStorage = () => setStarredIds(loadStarredIds());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    Promise.all([
      analytics.dashboard().catch(() => ({ data: null })),
      opportunities.queue().catch(() => ({ data: [] })),
      grants.list({ limit: 50 }).catch(() => ({ data: [] })),
    ]).then(([statsRes, queueRes, grantsRes]) => {
      setStats(statsRes.data);
      setQueue((queueRes.data as QueueItem[]).slice(0, 10));
      setGrantList(grantsRes.data as GrantItem[]);
    }).finally(() => setLoading(false));
  }, []);

  const statChips = stats ? [
    {
      label: 'Pending Review',
      value: stats.high_fit_pending_review,
      href: '/opportunities',
      tint: stats.high_fit_pending_review > 0 ? 'text-blue-600 bg-blue-50 border-blue-100' : 'text-gray-500 bg-gray-50 border-gray-100',
    },
    {
      label: 'Active Grants',
      value: stats.active_grants,
      href: '/grants',
      tint: 'text-gray-700 bg-gray-50 border-gray-100',
    },
    {
      label: 'Due in 30d',
      value: stats.grants_due_within_30_days,
      href: '/grants',
      tint: stats.grants_due_within_30_days > 0 ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-gray-500 bg-gray-50 border-gray-100',
    },
    {
      label: 'Overdue Tasks',
      value: stats.overdue_tasks,
      href: '/grants',
      tint: stats.overdue_tasks > 0 ? 'text-red-600 bg-red-50 border-red-100' : 'text-gray-500 bg-gray-50 border-gray-100',
    },
  ] : [];

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-1">{todayLabel()}</p>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{greeting(userName)}</h1>
          <p className="text-sm text-gray-400 mt-0.5">Here&apos;s what needs your attention today.</p>
        </div>

        {/* Stat chips */}
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {loading
            ? [1,2,3,4].map(i => <div key={i} className="h-7 w-28 rounded-full bg-gray-100 animate-pulse" />)
            : statChips.map(chip => (
              <Link key={chip.label} href={chip.href}>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold transition-all hover:shadow-sm ${chip.tint}`}>
                  <span className="tabular-nums">{chip.value}</span>
                  <span className="font-normal opacity-70">{chip.label}</span>
                </span>
              </Link>
            ))
          }
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/opportunities">
          <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-900 transition-all shadow-sm">
            Browse Opportunities
            <ChevronRight className="w-3 h-3 opacity-50" />
          </button>
        </Link>
        <Link href="/grants">
          <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-900 transition-all shadow-sm">
            View Pipeline
            <ChevronRight className="w-3 h-3 opacity-50" />
          </button>
        </Link>
        <Link href="/partners">
          <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-900 transition-all shadow-sm">
            Partners
            <ChevronRight className="w-3 h-3 opacity-50" />
          </button>
        </Link>
      </div>

      {/* ── Focus + Scratchpad ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-stretch" style={{ minHeight: 280 }}>
        <div className="lg:col-span-3">
          <FocusPanel grants={grantList} loading={loading} />
        </div>
        <div className="lg:col-span-2">
          <Scratchpad />
        </div>
      </div>

      {/* ── Grant Timeline (Gantt) ── */}
      <GrantTimeline grants={grantList} loading={loading} starredIds={starredIds} />

      {/* ── Review Queue — New Opportunities This Week ── */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-gray-900">New Opportunities</h2>
            {!loading && stats && stats.new_opportunities_this_week > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-blue-500 px-2 py-0.5 rounded-full">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                </span>
                {stats.new_opportunities_this_week} this week
              </span>
            )}
          </div>
          <Link href="/opportunities" className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            View all <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-gray-300">Loading...</div>
        ) : queue.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-gray-400">All caught up</p>
            <p className="text-xs text-gray-300 mt-1">No new opportunities to review</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {queue.map(opp => (
              <Link key={opp.id} href={`/opportunities/${opp.id}`}>
                <div className="px-5 py-3 hover:bg-gray-50/70 transition-colors flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 flex items-start gap-2">
                    {!opp.is_read && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-sm truncate leading-snug ${
                        !opp.is_read ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'
                      }`}>{opp.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {[opp.funder, opp.deadline ? formatDate(opp.deadline) : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2.5">
                    {opp.fit_score != null && <ScoreBar score={opp.fit_score} />}
                    {opp.priority && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[opp.priority] ?? 'bg-gray-100 text-gray-400'}`}>
                        {PRIORITY_LABEL[opp.priority] ?? opp.priority}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
