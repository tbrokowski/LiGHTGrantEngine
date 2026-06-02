'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { finance } from '@/lib/api';

interface FundRequestRow {
  id: string;
  grant_id: string;
  grant_title?: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  vendor?: string | null;
  created_at?: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  under_review: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-indigo-100 text-indigo-700',
};

export default function FinanceRequestsPage() {
  const [requests, setRequests] = useState<FundRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const load = useCallback(() => {
    setLoading(true);
    finance.listAllFundRequests(filter === 'open' ? undefined : 'all')
      .then(r => setRequests(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Fund requests across all active grants</p>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setFilter('open')}
            className={`text-xs px-3 py-1.5 rounded-md ${filter === 'open' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-md ${filter === 'all' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}
          >
            All
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
          No fund requests in this view.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 border-b">
                <th className="text-left py-2 px-3">Request</th>
                <th className="text-left py-2 px-3">Grant</th>
                <th className="text-right py-2 px-3">Amount</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-right py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/80">
                  <td className="py-2.5 px-3 font-medium text-gray-900">{r.title}</td>
                  <td className="py-2.5 px-3 text-gray-600">{r.grant_title ?? '—'}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {r.currency} {r.amount.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[r.status] ?? STATUS_STYLES.pending}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <Link href={`/finance/${r.grant_id}`} className="text-xs text-emerald-600 hover:underline">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
