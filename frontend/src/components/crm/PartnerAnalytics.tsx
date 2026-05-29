'use client';
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { partners as partnersApi } from '@/lib/api';

interface Analytics {
  by_stage: Record<string, number>;
  recent_interactions_30d: number;
  upcoming_meetings_30d: number;
  overdue_followups: number;
  stale_active_partners: number;
}

const STAGE_COLORS: Record<string, string> = {
  prospect: '#9ca3af',
  qualified: '#60a5fa',
  engaged: '#818cf8',
  collaborating: '#34d399',
  alumni: '#fbbf24',
};

export default function PartnerAnalytics() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    partnersApi.analytics().then(r => setAnalytics(r.data)).catch(() => {});
  }, []);

  if (!analytics) return null;

  const stageData = Object.entries(analytics.by_stage).map(([stage, count]) => ({
    stage: stage.charAt(0).toUpperCase() + stage.slice(1),
    count,
    color: STAGE_COLORS[stage] || '#9ca3af',
  })).sort((a, b) => {
    const order = ['Prospect', 'Qualified', 'Engaged', 'Collaborating', 'Alumni'];
    return order.indexOf(a.stage) - order.indexOf(b.stage);
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Partner Pipeline</h3>

      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Interactions (30d)', value: analytics.recent_interactions_30d, color: 'text-blue-600' },
          { label: 'Upcoming meetings', value: analytics.upcoming_meetings_30d, color: 'text-purple-600' },
          { label: 'Overdue follow-ups', value: analytics.overdue_followups, color: 'text-red-600' },
          { label: 'Stale (90d+)', value: analytics.stale_active_partners, color: 'text-amber-600' },
        ].map(m => (
          <div key={m.label} className="text-center">
            <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Stage bar chart */}
      {stageData.length > 0 && (
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={stageData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <XAxis dataKey="stage" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}
              formatter={(v: number) => [v, 'Partners']}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {stageData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
