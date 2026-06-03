'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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

function statusBadge(status?: string): { label: string; bg: string; color: string } {
  if (status === 'over_budget') return { label: 'Over budget', bg: 'var(--state-danger-bg)', color: 'var(--state-danger)' };
  if (status === 'at_risk') return { label: 'At risk', bg: 'var(--state-warning-bg)', color: 'var(--state-warning)' };
  if (status === 'on_track') return { label: 'On track', bg: 'var(--state-success-bg)', color: 'var(--state-success)' };
  return { label: 'Setup needed', bg: 'var(--surface-sunken)', color: 'var(--ink-muted)' };
}

function utilizationColor(pct: number) {
  if (pct >= 100) return 'var(--state-danger)';
  if (pct >= 80) return 'var(--state-warning)';
  return 'var(--accent-cool)';
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
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      {loading ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>Loading portfolio…</div>
      ) : (
        <>
          {/* Metric strip */}
          {summary && (
            <div
              className="flex shrink-0"
              style={{ borderBottom: '1px solid var(--rule-subtle)' }}
            >
              {[
                { label: 'Active grants', value: String(summary.grant_count), alert: false },
                { label: 'Total awarded', value: formatCurrency(summary.total_awarded), alert: false },
                { label: 'Available', value: formatCurrency(summary.total_available), alert: false, accent: true },
                {
                  label: 'Pending requests',
                  value: String(summary.pending_requests),
                  sub: summary.at_risk_count > 0 ? `${summary.at_risk_count} at risk` : null,
                  alert: summary.at_risk_count > 0,
                },
              ].map((cell, i) => (
                <div
                  key={i}
                  className="flex-1 px-6 py-4"
                  style={i > 0 ? { borderLeft: '1px solid var(--rule-subtle)' } : undefined}
                >
                  <p className="ledger-label">{cell.label}</p>
                  <p
                    className="mono-data mt-1"
                    style={{
                      fontSize: '18px',
                      color: cell.alert ? 'var(--state-warning)' : cell.accent ? 'var(--accent-cool)' : 'var(--ink-primary)',
                    }}
                  >
                    {cell.value}
                  </p>
                  {cell.sub && (
                    <p className="mono-data text-[10px] mt-0.5" style={{ color: 'var(--state-warning)' }}>
                      {cell.sub}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Grant list */}
          <div className="flex-1 overflow-y-auto">
            {grants.length === 0 ? (
              <div
                className="mx-6 my-6 py-16 text-center"
                style={{
                  border: '1px dashed var(--rule-strong)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>
                  No active grants with finance tracking
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                  Move a grant to Active on the{' '}
                  <Link href="/grants" style={{ color: 'var(--accent-primary)' }} className="hover:underline">Grants</Link>{' '}
                  page, then set up its ledger.
                </p>
              </div>
            ) : (
              grants.map(g => {
                const badge = statusBadge(g.finance?.status);
                const util = g.finance?.utilization_pct ?? 0;
                const accentBar = g.color ?? 'var(--rule-subtle)';
                return (
                  <Link
                    key={g.id}
                    href={`/finance/${g.id}`}
                    className="flex items-stretch transition-colors duration-100"
                    style={{ borderBottom: '1px solid var(--rule-subtle)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Left accent bar */}
                    <div className="w-1 shrink-0 self-stretch" style={{ background: accentBar, minHeight: '60px' }} />

                    {/* Content */}
                    <div className="flex-1 min-w-0 px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                              style={{ background: badge.bg, color: badge.color }}
                            >
                              {badge.label}
                            </span>
                            {g.finance?.pending_requests ? (
                              <span className="mono-data text-[10px]" style={{ color: 'var(--accent-primary)' }}>
                                {g.finance.pending_requests} pending request{g.finance.pending_requests !== 1 ? 's' : ''}
                              </span>
                            ) : null}
                          </div>
                          <h2 className="text-sm font-medium leading-snug" style={{ color: 'var(--ink-primary)' }}>
                            {g.title}
                          </h2>
                          <p className="mono-data text-[11px] mt-1 truncate" style={{ color: 'var(--ink-muted)' }}>
                            {[g.funder, g.pi_name && `PI: ${g.pi_name}`].filter(Boolean).join('  ·  ')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="mono-data text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
                            {formatCurrency(g.award_amount, g.currency)}
                          </p>
                          {g.finance?.total_available != null && g.finance.enabled && (
                            <p className="mono-data text-[11px] mt-0.5" style={{ color: 'var(--accent-cool)' }}>
                              {formatCurrency(g.finance.total_available, g.finance.currency ?? g.currency)} avail.
                            </p>
                          )}
                        </div>
                      </div>
                      {g.finance?.enabled && g.finance.status !== 'not_setup' && (
                        <div className="mt-3 flex items-center gap-2">
                          <div
                            className="flex-1 h-0.5 overflow-hidden"
                            style={{ background: 'var(--rule-subtle)', borderRadius: 'var(--radius-xs)' }}
                          >
                            <div
                              className="h-full transition-all"
                              style={{
                                width: `${Math.min(100, util)}%`,
                                background: utilizationColor(util),
                                borderRadius: 'var(--radius-xs)',
                              }}
                            />
                          </div>
                          <span className="mono-data text-[10px] w-10 text-right" style={{ color: 'var(--ink-faint)' }}>
                            {util}%
                          </span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
