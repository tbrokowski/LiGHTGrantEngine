'use client';
import { useEffect, useState } from 'react';
import { analytics } from '@/lib/api';

interface DashboardStats {
  new_opportunities_this_week: number;
  high_fit_pending_review: number;
  active_grants: number;
  grants_due_within_30_days: number;
  overdue_tasks: number;
  archived_grants: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analytics.dashboard()
      .then(r => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const cards = stats ? [
    { label: 'New this week', value: stats.new_opportunities_this_week, color: 'bg-blue-50 border-blue-200', icon: '🔍' },
    { label: 'High-fit pending review', value: stats.high_fit_pending_review, color: 'bg-amber-50 border-amber-200', icon: '⭐' },
    { label: 'Active grants', value: stats.active_grants, color: 'bg-green-50 border-green-200', icon: '📝' },
    { label: 'Due within 30 days', value: stats.grants_due_within_30_days, color: 'bg-red-50 border-red-200', icon: '⏰' },
    { label: 'Overdue tasks', value: stats.overdue_tasks, color: 'bg-orange-50 border-orange-200', icon: '🚨' },
    { label: 'Archived grants', value: stats.archived_grants, color: 'bg-purple-50 border-purple-200', icon: '🗄️' },
  ] : [];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Grant Pipeline Dashboard</h1>
      {loading ? (
        <div className="text-gray-500">Loading dashboard...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map(card => (
            <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
              <div className="text-3xl mb-1">{card.icon}</div>
              <div className="text-3xl font-bold text-gray-900">{card.value}</div>
              <div className="text-sm text-gray-600 mt-1">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { href: '/opportunities', label: 'Review opportunity queue', icon: '📋' },
              { href: '/grants', label: 'View active grants', icon: '💼' },
              { href: '/archive', label: 'Browse grant archive', icon: '📚' },
              { href: '/settings/sources', label: 'Manage grant sources', icon: '⚙️' },
            ].map(action => (
              <a key={action.href} href={action.href}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 text-blue-700 text-sm font-medium">
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">AI Workflows</h2>
          <p className="text-xs text-gray-500 mb-3">All workflows powered by Qwen on your cluster.</p>
          <div className="space-y-2">
            {[
              'Analyze a grant call',
              'Generate go/no-go memo',
              'Draft proposal section',
              'Find similar past grants',
              'Run compliance check',
            ].map(action => (
              <div key={action} className="flex items-center gap-2 text-sm text-gray-700 p-1">
                <span className="text-purple-500">✦</span>
                <span>{action}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Available on opportunity and grant detail pages.</p>
        </div>
      </div>
    </div>
  );
}
