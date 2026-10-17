'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { opportunities } from '@/lib/api';
import { onOpportunitiesChanged } from '@/lib/opportunities-events';
import OpportunityTypeBadge from '@/components/opportunities/OpportunityTypeBadge';

interface Pick {
  id: string;
  title: string;
  funder: string | null;
  opportunity_type: string | null;
  deadline: string | null;
  award_max: number | null;
  currency: string | null;
  is_read?: boolean;
  is_new?: boolean;
}

interface PicksResponse {
  date: string;
  next_refresh: string;
  funder_count: number;
  items: Pick[];
}

function formatDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return d; }
}

function formatAward(amount: number | null, currency: string | null) {
  if (!amount) return null;
  const n = amount >= 1e6 ? `${(amount / 1e6).toFixed(amount % 1e6 ? 1 : 0)}M` : amount >= 1e3 ? `${Math.round(amount / 1e3)}k` : String(amount);
  return `up to ${currency ?? ''} ${n}`.replace('  ', ' ');
}

export default function DailyPicks() {
  const [data, setData] = useState<PicksResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    opportunities.dailyPicks({ limit: 10 })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onOpportunitiesChanged(load), [load]);

  // A tab left open overnight picks up the new day's list on its own.
  useEffect(() => {
    if (!data?.next_refresh) return;
    const ms = new Date(data.next_refresh).getTime() - Date.now();
    if (ms <= 0 || ms > 2 ** 31 - 1) return;
    const id = window.setTimeout(load, ms + 5_000);
    return () => window.clearTimeout(id);
  }, [data?.next_refresh, load]);

  const items = data?.items ?? [];
  const dayLabel = data?.date
    ? new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null;

  return (
    <div
      className="overflow-hidden"
      style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-lg)' }}
    >
      <div
        className="px-5 py-3.5 flex items-center justify-between gap-3"
        style={{ background: 'var(--panel-header-bg)', borderBottom: '1px solid var(--panel-header-rule)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--panel-header-text)' }}>
            Today&apos;s Opportunities
          </span>
          {!loading && items.length > 0 && (
            <span
              className="mono-data text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] truncate"
              style={{ background: 'rgba(28,60,114,0.12)', color: 'var(--panel-header-text)' }}
              title="The list is picked fresh each morning from your organization's feed"
            >
              {items.length} picks · {data?.funder_count ?? 0} funders{dayLabel ? ` · ${dayLabel}` : ''}
            </span>
          )}
        </div>
        <Link
          href="/opportunities"
          className="shrink-0 transition-colors"
          style={{ color: 'var(--ink-faint)', fontSize: '11px' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
        >
          View all →
        </Link>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No open opportunities to suggest today</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>A new list is picked each morning as sources are scanned</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2">
          {items.map(opp => {
            const meta = [opp.funder, opp.deadline ? `Due ${formatDate(opp.deadline)}` : 'Rolling', formatAward(opp.award_max, opp.currency)]
              .filter(Boolean).join('  ·  ');
            return (
              <Link key={opp.id} href={`/opportunities/${opp.id}`}>
                <div className="ledger-row px-5 py-3 flex items-start justify-between gap-3 h-full">
                  <div className="min-w-0 flex-1 flex items-start gap-2">
                    <span
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: opp.is_read ? 'transparent' : 'var(--accent-primary)' }}
                    />
                    <div className="min-w-0">
                      <p
                        className="text-sm truncate leading-snug"
                        style={{
                          fontWeight: opp.is_read ? 400 : 500,
                          color: opp.is_read ? 'var(--ink-muted)' : 'var(--ink-primary)',
                        }}
                      >
                        {opp.title}
                      </p>
                      <p className="mono-data text-[11px] mt-0.5 truncate" style={{ color: 'var(--ink-faint)' }}>
                        {meta}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {opp.is_new && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] mono-data"
                        style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
                      >
                        New
                      </span>
                    )}
                    <OpportunityTypeBadge type={opp.opportunity_type} size="xs" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
