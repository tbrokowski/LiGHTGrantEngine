'use client';
import { useEffect, useState } from 'react';
import { grants } from '@/lib/api';

interface Grant {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  priority: string | null;
  external_deadline: string | null;
  internal_deadline: string | null;
  pi_name: string | null;
  themes: string[];
}

const STATUS_COLORS: Record<string, string> = {
  scoping: 'bg-gray-100 text-gray-700',
  full_proposal_drafting: 'bg-blue-100 text-blue-800',
  internal_review: 'bg-amber-100 text-amber-800',
  submitted: 'bg-green-100 text-green-800',
  awarded: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function GrantsPage() {
  const [grantList, setGrantList] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    grants.list(statusFilter ? { status: statusFilter } : {})
      .then(r => setGrantList(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Active Grants</h1>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {['scoping','go_no_go_pending','concept_note_drafting','full_proposal_drafting',
            'internal_review','pi_review','submitted','awarded','rejected'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
          ))}
        </select>
      </div>

      {loading ? <div className="text-gray-500">Loading grants...</div> : (
        <div className="space-y-3">
          {grantList.map(g => (
            <a key={g.id} href={`/grants/${g.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{g.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {g.funder} {g.pi_name && `· PI: ${g.pi_name}`}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {g.external_deadline && `Ext. deadline: ${g.external_deadline}`}
                    {g.internal_deadline && ` · Int. deadline: ${g.internal_deadline}`}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[g.status] || 'bg-gray-100 text-gray-700'}`}>
                  {g.status.replace(/_/g,' ')}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
