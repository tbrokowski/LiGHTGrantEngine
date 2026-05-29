'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Flame, AlertOctagon, Network, ArrowLeft } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface Partner {
  id: string;
  name: string;
  email?: string;
  organization?: string;
  relationship_stage: string;
  status: string;
  h_index?: number;
  next_contact_date?: string;
  updated_at?: string;
  owner_name?: string;
}

const STAGE_LABELS: Record<string, string> = {
  prospect: 'Prospect', qualified: 'Qualified', engaged: 'Engaged',
  collaborating: 'Collaborating', alumni: 'Alumni',
};

function formatDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d ?? '—'; }
}

function daysSince(d?: string | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
}

export default function PartnersReportsPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [analytics, setAnalytics] = useState<{
    by_stage: Record<string, number>;
    recent_interactions_30d: number;
    upcoming_meetings_30d: number;
    overdue_followups: number;
    stale_active_partners: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      partnersApi.list({ limit: 500 }),
      partnersApi.analytics(),
    ]).then(([pRes, aRes]) => {
      setPartners(pRes.data || []);
      setAnalytics(aRes.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="px-6 py-6 max-w-6xl mx-auto animate-pulse space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
            {[1, 2, 3].map(j => <div key={j} className="h-3 w-full bg-gray-100 rounded mb-2" />)}
          </div>
        ))}
      </div>
    );
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Most engaged: recently active partners (updated in last 30 days)
  const mostEngaged = partners
    .filter(p => p.updated_at && new Date(p.updated_at) > thirtyDaysAgo)
    .sort((a, b) => (b.updated_at || '') > (a.updated_at || '') ? 1 : -1)
    .slice(0, 10);

  // At-risk: active collaborators with no contact in 60+ days
  const atRisk = partners
    .filter(p => p.relationship_stage === 'collaborating' && p.status === 'active')
    .filter(p => !p.updated_at || new Date(p.updated_at) < sixtyDaysAgo)
    .sort((a, b) => (a.updated_at || '') > (b.updated_at || '') ? 1 : -1)
    .slice(0, 10);

  // Overdue follow-ups
  const overdue = partners
    .filter(p => p.next_contact_date && new Date(p.next_contact_date) < now)
    .sort((a, b) => (a.next_contact_date || '') > (b.next_contact_date || '') ? 1 : -1)
    .slice(0, 10);

  // Pipeline stage distribution for velocity chart
  const stageCounts = analytics?.by_stage || {};
  const totalPartners = partners.length;

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/partners" className="flex items-center gap-1 hover:text-gray-700">
          <ArrowLeft className="w-3.5 h-3.5" />Partners
        </Link>
        <span>/</span>
        <span className="text-gray-600">Analytics Reports</span>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Partner Analytics</h1>
      <p className="text-sm text-gray-500 mb-6">Pipeline health, engagement, and relationship quality at a glance.</p>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Partners', value: totalPartners, color: 'text-gray-900' },
          { label: 'Active Collaborators', value: stageCounts['collaborating'] || 0, color: 'text-green-700' },
          { label: 'Overdue Follow-ups', value: analytics?.overdue_followups || 0, color: 'text-red-600' },
          { label: 'Stale (90+ days)', value: analytics?.stale_active_partners || 0, color: 'text-amber-600' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-gray-500 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pipeline velocity */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-800">Pipeline Distribution</h2>
          </div>
          <div className="space-y-2.5">
            {['prospect', 'qualified', 'engaged', 'collaborating', 'alumni'].map(stage => {
              const count = stageCounts[stage] || 0;
              const pct = totalPartners > 0 ? Math.round((count / totalPartners) * 100) : 0;
              const barColors: Record<string, string> = {
                prospect: 'bg-gray-300',
                qualified: 'bg-blue-400',
                engaged: 'bg-indigo-400',
                collaborating: 'bg-green-400',
                alumni: 'bg-amber-400',
              };
              return (
                <div key={stage}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>{STAGE_LABELS[stage]}</span>
                    <span className="font-medium">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColors[stage]} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
            {analytics?.recent_interactions_30d ?? 0} interactions in last 30 days ·{' '}
            {analytics?.upcoming_meetings_30d ?? 0} meetings upcoming
          </div>
        </div>

        {/* Most engaged */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-gray-800">Most Engaged (30 days)</h2>
          </div>
          {mostEngaged.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">No recent activity.</div>
          ) : (
            <div className="space-y-2">
              {mostEngaged.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-300 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <Link href={`/partners/${p.id}`} className="text-sm font-medium text-gray-800 hover:text-blue-600 truncate block">
                      {p.name}
                    </Link>
                    <div className="text-xs text-gray-400 truncate">{p.organization || '—'}</div>
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(p.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* At-risk partners */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertOctagon className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-semibold text-gray-800">At-Risk Collaborators (60+ days no contact)</h2>
          </div>
          {atRisk.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">All active collaborators have recent contact. Great work!</div>
          ) : (
            <div className="space-y-2">
              {atRisk.map(p => {
                const days = daysSince(p.updated_at);
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/partners/${p.id}`} className="text-sm font-medium text-gray-800 hover:text-blue-600 truncate block">
                        {p.name}
                      </Link>
                      <div className="text-xs text-gray-400 truncate">{p.organization || '—'}</div>
                    </div>
                    <span className="text-xs font-medium text-red-600 whitespace-nowrap">
                      {days != null ? `${days} days` : 'No contact'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Overdue follow-ups */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-semibold text-gray-800">Overdue Follow-ups</h2>
          </div>
          {overdue.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">No overdue follow-ups. You're on top of it!</div>
          ) : (
            <div className="space-y-2">
              {overdue.map(p => {
                const days = p.next_contact_date ? daysSince(p.next_contact_date) : null;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/partners/${p.id}`} className="text-sm font-medium text-gray-800 hover:text-blue-600 truncate block">
                        {p.name}
                      </Link>
                      <div className="text-xs text-gray-400 truncate">{p.organization || '—'}</div>
                    </div>
                    <span className="text-xs font-medium text-amber-600 whitespace-nowrap">
                      {days != null ? `${days} days overdue` : formatDate(p.next_contact_date)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
