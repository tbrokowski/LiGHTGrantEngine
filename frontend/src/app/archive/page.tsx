'use client';
import { useEffect, useState } from 'react';
import { archive } from '@/lib/api';

interface ArchiveEntry {
  id: string;
  title: string;
  funder: string | null;
  call_year: number | null;
  outcome: string | null;
  lead_pi: string | null;
  themes: string[];
  requested_amount: number | null;
  awarded_amount: number | null;
  currency: string | null;
}

const OUTCOME_COLORS: Record<string, string> = {
  awarded: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  pending: 'bg-amber-100 text-amber-800',
  withdrawn: 'bg-gray-100 text-gray-600',
};

export default function ArchivePage() {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    archive.list(search ? { search } : {})
      .then(r => setEntries(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Grant Archive</h1>
          <p className="text-sm text-gray-500 mt-1">Living institutional memory — all past grants</p>
        </div>
        <input type="text" placeholder="Search archive..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-60" />
      </div>
      {loading ? <div className="text-gray-500">Loading...</div> : (
        <div className="space-y-3">
          {entries.map(entry => (
            <a key={entry.id} href={`/archive/${entry.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{entry.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {entry.funder} {entry.call_year && `· ${entry.call_year}`} {entry.lead_pi && `· ${entry.lead_pi}`}
                  </div>
                  {entry.requested_amount && (
                    <div className="text-xs text-gray-400 mt-1">
                      Requested: {entry.currency} {entry.requested_amount?.toLocaleString()}
                      {entry.awarded_amount && ` · Awarded: ${entry.awarded_amount?.toLocaleString()}`}
                    </div>
                  )}
                </div>
                {entry.outcome && (
                  <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${OUTCOME_COLORS[entry.outcome] || 'bg-gray-100 text-gray-600'}`}>
                    {entry.outcome}
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
