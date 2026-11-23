'use client';
// Grid view: every funder in one sortable ledger, grouped visually by tier.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Linkedin, MessageSquarePlus, ListPlus } from 'lucide-react';
import { Avatar, DueChip, PriorityBars, WeekStrip, sinceLabel } from '@/components/crm/crmUi';
import { TIER_BY_KEY, TierKey, TierMenu, tint } from './tiers';
import { FunderRow, funderHref, health, place } from './types';

const GRID = '3px 30px minmax(180px,2.2fr) 150px minmax(140px,1.6fr) minmax(110px,1fr) 64px 132px 118px 64px';

export default function FunderTable({
  rows, onTier, onPriority, onLog, onTask,
}: {
  rows: FunderRow[];
  onTier: (f: FunderRow, tier: TierKey | null) => void;
  onPriority: (f: FunderRow, p: number) => void;
  onLog: (f: FunderRow) => void;
  onTask: (f: FunderRow) => void;
}) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1080px]">
        <div className="grid gap-3 pl-0 pr-4 py-2 items-center" style={{ gridTemplateColumns: GRID, background: 'var(--surface-sunken)', borderBottom: '1px solid var(--rule-subtle)' }}>
          <span /><span />
          <span className="ledger-label">Name</span>
          <span className="ledger-label">Tier</span>
          <span className="ledger-label">Organization</span>
          <span className="ledger-label">Based in</span>
          <span className="ledger-label">Priority</span>
          <span className="ledger-label">Follow-up</span>
          <span className="ledger-label">Last 12 wks</span>
          <span />
        </div>
        {rows.map(f => {
          const t = TIER_BY_KEY[f.funder_tier];
          const h = health(f.last_touch);
          return (
            <div key={f.id} role="link" tabIndex={0}
              onClick={() => router.push(funderHref(f.id))}
              onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) router.push(funderHref(f.id)); }}
              className="group grid gap-3 pr-4 py-2 items-center cursor-pointer transition-colors hover:bg-[var(--selection-bg)] focus-visible:bg-[var(--selection-bg)] outline-none"
              style={{ gridTemplateColumns: GRID, borderBottom: '1px solid var(--rule-subtle)' }}>
              <span className="self-stretch rounded-r" style={{ background: t?.color ?? 'transparent', opacity: f.funder_tier === 'unsorted' ? 0.35 : 0.9 }} />
              <span className="relative">
                <Avatar name={f.name} size={30} />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" title={h.label}
                  style={{ background: h.color, boxShadow: '0 0 0 2px var(--surface-base)' }} />
              </span>
              <div className="min-w-0">
                <Link href={funderHref(f.id)} onClick={e => e.stopPropagation()}
                  className="block text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>
                  {f.name}
                </Link>
                <div className="text-[11px] truncate flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
                  {f.title || (f.enrichment_status === 'pending' ? <i>Researching online…</i> : '—')}
                  {f.linkedin_url && (
                    <a href={f.linkedin_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      aria-label={`${f.name} on LinkedIn`} className="hover:opacity-70"><Linkedin className="w-3 h-3" /></a>
                  )}
                </div>
              </div>
              <div onClick={e => e.stopPropagation()}>
                <TierMenu value={f.funder_tier} onChange={tier => onTier(f, tier)} allowRemove />
              </div>
              <div className="min-w-0 text-[13px] truncate" style={{ color: 'var(--ink-secondary)' }}>
                {f.organization_id
                  ? <Link href={`/partners/organizations/${f.organization_id}`} onClick={e => e.stopPropagation()} className="hover:underline">{f.org_name}</Link>
                  : (f.org_name || <span style={{ color: 'var(--ink-faint)' }}>—</span>)}
              </div>
              <div className="text-[12px] truncate" style={{ color: 'var(--ink-muted)' }}>{place(f) || '—'}</div>
              <div onClick={e => e.stopPropagation()}><PriorityBars value={f.priority} onChange={p => onPriority(f, p)} /></div>
              <div className="flex items-center gap-1.5 min-w-0">
                {f.open_tasks > 0 ? (
                  <>
                    <DueChip due={f.next_task_due} />
                    <span className="mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>{f.open_tasks} open</span>
                  </>
                ) : f.next_contact_date ? (
                  <DueChip due={f.next_contact_date} />
                ) : (
                  <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>None set</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <WeekStrip weeks={f.weeks} />
                <span className="mono-data text-[11px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>{sinceLabel(f.last_touch)}</span>
              </div>
              <div className="flex items-center gap-0.5 justify-end opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={() => onLog(f)} title="Log an email, call or meeting" aria-label={`Log a touch with ${f.name}`}
                  className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-secondary)' }}>
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => onTask(f)} title="Add a task" aria-label={`Add a task for ${f.name}`}
                  className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-secondary)' }}>
                  <ListPlus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small legend chip used above the table when filtering by tier. */
export function TierCountChip({ tierKey, count, active, onClick }: { tierKey: TierKey; count: number; active: boolean; onClick: () => void }) {
  const t = TIER_BY_KEY[tierKey];
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={t.blurb}
      className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-full text-xs font-medium transition-colors"
      style={{
        border: `1px solid ${active ? t.color : 'var(--rule-subtle)'}`,
        background: active ? tint(t.color, '14') : 'var(--surface-base)',
        color: active ? (t.key === 'unsorted' ? 'var(--ink-primary)' : t.color) : 'var(--ink-secondary)',
        opacity: count ? 1 : 0.55,
      }}>
      <span aria-hidden style={{ fontSize: 13 * (t.scale ?? 1), lineHeight: 1 }}>{t.emoji}</span>
      {t.label}
      <span className="mono-data" style={{ color: 'var(--ink-muted)' }}>{count}</span>
    </button>
  );
}
