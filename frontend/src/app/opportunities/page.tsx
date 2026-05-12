'use client';
import { useEffect, useState } from 'react';
import { opportunities } from '@/lib/api';

interface Opportunity {
  id: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  fit_score: number | null;
  priority: string | null;
  status: string;
  thematic_areas: string[];
  award_min: number | null;
  award_max: number | null;
  currency: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  high_priority: 'bg-red-100 text-red-800',
  worth_reviewing: 'bg-amber-100 text-amber-800',
  watchlist: 'bg-blue-100 text-blue-800',
  low_fit: 'bg-gray-100 text-gray-600',
};

export default function OpportunitiesPage() {
  const [queue, setQueue] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    opportunities.queue()
      .then(r => setQueue(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = queue.filter(o =>
    !filter || o.title.toLowerCase().includes(filter.toLowerCase()) ||
    (o.funder || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
          <p className="text-sm text-gray-500 mt-1">New opportunities awaiting triage</p>
        </div>
        <input
          type="text"
          placeholder="Search..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-60"
        />
      </div>

      {loading ? (
        <div className="text-gray-500">Loading queue...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">Queue is clear 🎉</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(opp => (
            <a key={opp.id} href={`/opportunities/${opp.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{opp.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {opp.funder} {opp.deadline && `· Due ${opp.deadline}`}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {opp.thematic_areas?.slice(0, 4).map(t => (
                      <span key={t} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {opp.fit_score !== null && (
                    <span className="text-lg font-bold text-gray-900">{opp.fit_score?.toFixed(0)}</span>
                  )}
                  {opp.priority && (
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${PRIORITY_COLORS[opp.priority] || ''}`}>
                      {opp.priority.replace('_', ' ')}
                    </span>
                  )}
                  {opp.award_max && (
                    <span className="text-xs text-gray-500">
                      {opp.currency} {opp.award_max?.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
