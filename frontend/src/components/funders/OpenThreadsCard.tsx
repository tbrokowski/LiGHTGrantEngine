'use client';
// Open threads: team conversations on the Funders tab, each with the funders
// it concerns assigned to it. Click one to read, reply and assign people.
import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare, Plus } from 'lucide-react';
import { funderThreads } from '@/lib/api';
import { btnOutline, card } from '@/components/crm/crmUi';
import { TIER_BY_KEY } from './tiers';
import { FunderRow } from './types';
import ThreadModal from './ThreadModal';
import { FunderThread, firstName, whenLabel } from './threadTypes';

const SHOWN = 5;
const CHIPS = 3;

export default function OpenThreadsCard({ funders }: { funders: FunderRow[] }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [threads, setThreads] = useState<FunderThread[] | null>(null);
  const [counts, setCounts] = useState({ open: 0, closed: 0 });
  const [all, setAll] = useState(false);
  // undefined: no modal; null: starting a new thread; string: that thread.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);

  const load = useCallback(() => {
    funderThreads.list(status)
      .then(r => { setThreads(r.data.threads || []); setCounts(r.data.counts || { open: 0, closed: 0 }); })
      .catch(() => setThreads([]));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAll(false); }, [status]);

  const shown = all ? threads : threads?.slice(0, SHOWN);
  const other = status === 'open' ? 'closed' : 'open';

  return (
    <div className="flex flex-col min-w-0" style={card}>
      <div className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--ink-primary)' }}>
            {status === 'open' ? 'Open threads' : 'Closed threads'}{' '}
            <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{counts[status] || ''}</span>
          </h2>
          {(counts[other] > 0 || status === 'closed') && (
            <button type="button" onClick={() => setStatus(other)} className="text-xs hover:underline whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
              {other === 'closed' ? `Closed (${counts.closed})` : `Back to open (${counts.open})`}
            </button>
          )}
        </div>
        <button type="button" onClick={() => setOpenId(null)} className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium shrink-0" style={btnOutline}>
          <Plus className="w-3.5 h-3.5" />New thread
        </button>
      </div>

      <ul>
        {threads === null && Array.from({ length: 2 }).map((_, i) => (
          <li key={i} className="px-[18px] py-3" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
            <div className="h-4 w-1/2 animate-pulse rounded" style={{ background: 'var(--surface-sunken)' }} />
          </li>
        ))}
        {shown?.map(t => (
          <li key={t.id} style={{ borderTop: '1px solid var(--rule-subtle)' }}>
            <button type="button" onClick={() => setOpenId(t.id)}
              className="w-full flex items-start gap-3 px-[18px] py-2.5 text-left hover:bg-[var(--surface-sunken)]">
              <span className="mt-0.5 w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
                <MessagesSquare className="w-3.5 h-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate" style={{ color: t.status === 'closed' ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>{t.title}</div>
                {t.funders.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {t.funders.slice(0, CHIPS).map(f => {
                      const tier = TIER_BY_KEY[f.funder_tier ?? ''];
                      return (
                        <span key={f.id} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-px rounded-full max-w-[150px]"
                          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
                          {tier && <span aria-hidden className="leading-none">{tier.emoji}</span>}
                          <span className="truncate">{f.name}</span>
                        </span>
                      );
                    })}
                    {t.funders.length > CHIPS && (
                      <span className="text-[11px] mono-data" style={{ color: 'var(--ink-muted)' }}>+{t.funders.length - CHIPS}</span>
                    )}
                  </div>
                )}
                {t.last_post && (
                  <p className="text-[12px] leading-snug truncate mt-1" style={{ color: 'var(--ink-muted)' }}>
                    <span style={{ color: 'var(--ink-secondary)' }}>{firstName(t.last_post.user_name)}:</span> {t.last_post.content}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>{whenLabel(t.last_activity_at)}</span>
                {t.post_count > 0 && (
                  <span className="mono-data text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--ink-faint)' }} title={`${t.post_count} message${t.post_count === 1 ? '' : 's'}`}>
                    <MessagesSquare className="w-3 h-3" />{t.post_count}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
        {threads && !threads.length && (
          <li className="px-[18px] py-7 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
            {status === 'open' ? 'No open threads. Start one to discuss funders with the team.' : 'No closed threads.'}
          </li>
        )}
      </ul>
      {(threads?.length ?? 0) > SHOWN && (
        <button type="button" onClick={() => setAll(v => !v)} className="mt-auto px-[18px] py-2.5 text-left text-[13px] hover:bg-[var(--surface-sunken)]"
          style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
          {all ? 'Show fewer' : `Show all ${threads!.length}`}
        </button>
      )}

      {openId !== undefined && (
        <ThreadModal threadId={openId} funders={funders}
          onClose={() => setOpenId(undefined)}
          onChanged={load}
          onCreated={id => { setStatus('open'); setOpenId(id); load(); }} />
      )}
    </div>
  );
}
