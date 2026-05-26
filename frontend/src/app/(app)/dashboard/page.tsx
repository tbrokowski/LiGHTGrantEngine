'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { analytics, opportunities, grants } from '@/lib/api';
import { useAuth } from '@/lib/auth';

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

interface GrantItem {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  external_deadline: string | null;
}

const STATUS_BG: Record<string, string> = {
  scoping: 'bg-gray-100 text-gray-500',
  go_no_go_pending: 'bg-amber-50 text-amber-600',
  concept_note_drafting: 'bg-blue-50 text-blue-600',
  full_proposal_drafting: 'bg-blue-50 text-blue-700',
  internal_review: 'bg-violet-50 text-violet-600',
  pi_review: 'bg-violet-50 text-violet-700',
  submitted: 'bg-emerald-50 text-emerald-600',
  awarded: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-500',
};

const STATUS_LABEL: Record<string, string> = {
  scoping: 'Scoping',
  go_no_go_pending: 'Go/No-go',
  concept_note_drafting: 'Concept note',
  full_proposal_drafting: 'Drafting',
  internal_review: 'Int. review',
  pi_review: 'PI review',
  submitted: 'Submitted',
  awarded: 'Awarded',
  rejected: 'Rejected',
};

const PRIORITY_COLOR: Record<string, string> = {
  high_priority: 'bg-red-100 text-red-600',
  worth_reviewing: 'bg-amber-100 text-amber-600',
  watchlist: 'bg-sky-100 text-sky-600',
  low_fit: 'bg-gray-100 text-gray-400',
};

const PRIORITY_LABEL: Record<string, string> = {
  high_priority: 'High',
  worth_reviewing: 'Worth',
  watchlist: 'Watch',
  low_fit: 'Low',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  try {
    const diff = new Date(d).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch { return null; }
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

// Inline SVG icons
const Icons = {
  review: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  grants: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  calendar: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  alert: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

export default function DashboardPage() {
  const { user } = useAuth();
  const userName = user?.name ?? null;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [grantList, setGrantList] = useState<GrantItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      analytics.dashboard().catch(() => ({ data: null })),
      opportunities.queue().catch(() => ({ data: [] })),
      grants.list({ limit: 10 }).catch(() => ({ data: [] })),
    ]).then(([statsRes, queueRes, grantsRes]) => {
      setStats(statsRes.data);
      setQueue((queueRes.data as QueueItem[]).slice(0, 8));
      setGrantList((grantsRes.data as GrantItem[]).slice(0, 8));
    }).finally(() => setLoading(false));
  }, []);

  // Upcoming deadlines from active grants (sorted, next 4 with a deadline)
  const upcomingDeadlines = grantList
    .filter(g => g.external_deadline)
    .sort((a, b) => new Date(a.external_deadline!).getTime() - new Date(b.external_deadline!).getTime())
    .slice(0, 4);

  const statCards = stats ? [
    {
      label: 'Pending review',
      value: stats.high_fit_pending_review,
      href: '/opportunities',
      alert: stats.high_fit_pending_review > 0,
      icon: Icons.review,
      iconBg: 'bg-blue-50 text-blue-500',
      valueTint: stats.high_fit_pending_review > 0 ? 'text-blue-600' : 'text-gray-900',
    },
    {
      label: 'Active grants',
      value: stats.active_grants,
      href: '/grants',
      alert: false,
      icon: Icons.grants,
      iconBg: 'bg-emerald-50 text-emerald-500',
      valueTint: 'text-gray-900',
    },
    {
      label: 'Due in 30 days',
      value: stats.grants_due_within_30_days,
      href: '/grants',
      alert: stats.grants_due_within_30_days > 0,
      icon: Icons.calendar,
      iconBg: stats.grants_due_within_30_days > 0 ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-400',
      valueTint: stats.grants_due_within_30_days > 0 ? 'text-amber-600' : 'text-gray-900',
    },
    {
      label: 'Overdue tasks',
      value: stats.overdue_tasks,
      href: '/grants',
      alert: stats.overdue_tasks > 0,
      icon: Icons.alert,
      iconBg: stats.overdue_tasks > 0 ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400',
      valueTint: stats.overdue_tasks > 0 ? 'text-red-600' : 'text-gray-900',
    },
  ] : [];

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">

      {/* Header */}
      <div className="mb-7">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-1.5">{todayLabel()}</p>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{greeting(userName)}</h1>
        <p className="text-sm text-gray-400 mt-0.5">Here&apos;s what needs your attention today.</p>
      </div>

      {/* New opportunities callout */}
      {!loading && stats && stats.new_opportunities_this_week > 0 && (
        <Link href="/opportunities">
          <div className="mb-6 flex items-center gap-3 bg-gradient-to-r from-gray-900 to-gray-800 text-white px-5 py-3.5 rounded-xl hover:from-gray-800 hover:to-gray-700 transition-all shadow-sm">
            <span className="flex h-2 w-2 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-40" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <span className="text-xs font-bold tracking-wide uppercase text-white/60 shrink-0">New</span>
            <span className="text-sm font-medium">
              {stats.new_opportunities_this_week} opportunit{stats.new_opportunities_this_week === 1 ? 'y' : 'ies'} discovered this week
            </span>
            <svg className="ml-auto w-4 h-4 opacity-40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      )}

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm animate-pulse">
              <div className="flex items-center justify-between mb-4">
                <div className="h-8 w-8 bg-gray-100 rounded-xl" />
              </div>
              <div className="h-8 w-10 bg-gray-100 rounded mb-2" />
              <div className="h-3 w-20 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {statCards.map(card => (
            <Link key={card.label} href={card.href}>
              <div className="group bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-gray-200 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className={`flex items-center justify-center h-8 w-8 rounded-xl ${card.iconBg}`}>
                    {card.icon}
                  </span>
                  {card.alert && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                  )}
                </div>
                <p className={`text-3xl font-light leading-none tabular-nums mb-2 ${card.valueTint}`}>{card.value}</p>
                <p className="text-xs font-medium text-gray-400">{card.label}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-7">
        <Link href="/opportunities">
          <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-900 transition-all shadow-sm">
            Browse Opportunities
            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </Link>
        <Link href="/grants">
          <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-900 transition-all shadow-sm">
            View Pipeline
            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </Link>
        <Link href="/partners">
          <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:text-gray-900 transition-all shadow-sm">
            Partners
            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </Link>
      </div>

      {/* Upcoming Deadlines strip */}
      {!loading && upcomingDeadlines.length > 0 && (
        <div className="mb-6 bg-white border border-gray-100 rounded-2xl shadow-sm px-5 py-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Upcoming Deadlines</p>
          <div className="flex flex-wrap gap-2">
            {upcomingDeadlines.map(g => {
              const days = daysUntil(g.external_deadline);
              const urgent = days !== null && days <= 14;
              const overdue = days !== null && days < 0;
              return (
                <Link key={g.id} href={`/grants/${g.id}`}>
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all hover:shadow-sm ${
                    overdue ? 'border-red-100 bg-red-50' :
                    urgent ? 'border-amber-100 bg-amber-50' :
                    'border-gray-100 bg-gray-50'
                  }`}>
                    <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${overdue ? 'bg-red-400' : urgent ? 'bg-amber-400' : 'bg-gray-300'}`} />
                    <span className="text-xs font-medium text-gray-700 max-w-[160px] truncate">{g.title}</span>
                    <span className={`text-xs font-semibold shrink-0 ${overdue ? 'text-red-500' : urgent ? 'text-amber-600' : 'text-gray-400'}`}>
                      {overdue ? `${Math.abs(days!)}d overdue` : days === 0 ? 'Today' : `${days}d`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Review Queue panel */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Review Queue</h2>
            <Link href="/opportunities" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-gray-300">Loading…</div>
          ) : queue.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-400">Queue is clear</p>
              <p className="text-xs text-gray-300 mt-1">No opportunities pending review</p>
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
                      {opp.fit_score != null && (
                        <ScoreBar score={opp.fit_score} />
                      )}
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

        {/* Active Grants panel */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Active Grants</h2>
            <Link href="/grants" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-gray-300">Loading…</div>
          ) : grantList.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-400">No active grants</p>
              <Link href="/opportunities" className="text-xs text-gray-400 hover:text-gray-600 underline-offset-2 hover:underline mt-1 block">
                Convert an opportunity →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {grantList.map(g => (
                <Link key={g.id} href={`/grants/${g.id}`}>
                  <div className="px-5 py-3 hover:bg-gray-50/70 transition-colors flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate leading-snug">{g.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {[g.funder, g.external_deadline ? formatDate(g.external_deadline) : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_BG[g.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABEL[g.status] ?? g.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
