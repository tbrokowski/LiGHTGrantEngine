'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, DollarSign, TrendingUp } from 'lucide-react';
import { finance } from '@/lib/api';

interface FinanceGrantRow {
  id: string;
  title: string;
  funder?: string | null;
  pi_name?: string | null;
  award_amount?: number | null;
  currency?: string | null;
  external_deadline?: string | null;
  color?: string | null;
  finance: {
    enabled: boolean;
    status?: string;
    utilization_pct?: number;
    total_available?: number;
    pending_requests?: number;
    currency?: string;
  };
}

interface PortfolioSummary {
  grant_count: number;
  total_awarded: number;
  total_available: number;
  at_risk_count: number;
  pending_requests: number;
}

function formatCurrency(amount: number | null | undefined, currency?: string | null) {
  if (amount == null) return '—';
  const sym = currency && currency !== 'USD' ? `${currency} ` : '$';
  return `${sym}${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function statusBadge(status?: string) {
  if (status === 'over_budget') return { label: 'Over budget', cls: 'bg-red-100 text-red-700 border-red-200' };
  if (status === 'at_risk') return { label: 'At risk', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (status === 'on_track') return { label: 'On track', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  return { label: 'Setup needed', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
}

export default function FinancePage() {
  const [grants, setGrants] = useState<FinanceGrantRow[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    finance.portfolio()
      .then(r => {
        setGrants(r.data.grants ?? []);
        setSummary(r.data.summary ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto space-y-6">
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading portfolio…</div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Active grants</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary.grant_count}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Total awarded</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(summary.total_awarded)}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="text-xs text-emerald-700 uppercase tracking-widest">Available</p>
                <p className="text-2xl font-bold text-emerald-800 mt-1">{formatCurrency(summary.total_available)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Pending requests</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{summary.pending_requests}</p>
                {summary.at_risk_count > 0 && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {summary.at_risk_count} at risk
                  </p>
                )}
              </div>
            </div>
          )}

          {grants.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
              <DollarSign className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600 font-medium">No active grants with finance tracking</p>
              <p className="text-xs text-gray-400 mt-1">
                Move a grant to Active on the{' '}
                <Link href="/grants" className="text-emerald-600 hover:underline">Grants</Link> page, then set up its ledger.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {grants.map(g => {
                const badge = statusBadge(g.finance?.status);
                const util = g.finance?.utilization_pct ?? 0;
                return (
                  <Link
                    key={g.id}
                    href={`/finance/${g.id}`}
                    className="block bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-emerald-300 hover:shadow-sm transition-all"
                    style={g.color ? { borderLeftWidth: 4, borderLeftColor: g.color } : undefined}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {g.finance?.pending_requests ? (
                            <span className="text-xs text-blue-600">
                              {g.finance.pending_requests} pending request{g.finance.pending_requests !== 1 ? 's' : ''}
                            </span>
                          ) : null}
                        </div>
                        <h2 className="text-sm font-semibold text-gray-900 truncate">{g.title}</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[g.funder, g.pi_name && `PI: ${g.pi_name}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-900">
                          {formatCurrency(g.award_amount, g.currency)}
                        </p>
                        {g.finance?.total_available != null && g.finance.enabled && (
                          <p className="text-xs text-emerald-600 mt-0.5">
                            {formatCurrency(g.finance.total_available, g.finance.currency ?? g.currency)} avail.
                          </p>
                        )}
                      </div>
                    </div>
                    {g.finance?.enabled && g.finance.status !== 'not_setup' && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              util >= 100 ? 'bg-red-500' : util >= 80 ? 'bg-amber-400' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, util)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 tabular-nums w-10 text-right">{util}%</span>
                        <TrendingUp className="w-3.5 h-3.5 text-gray-300" />
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
