'use client';
// The people in the chosen tier, one card each. A card opens the person's
// partner page; drag it onto a tier in the bar above (or use the tier menu) to
// move them.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckSquare, ListPlus, MessageSquarePlus } from 'lucide-react';
import { Avatar, DueChip, sinceLabel } from '@/components/crm/crmUi';
import { TIER_BY_KEY, TierKey, TierMenu, tint } from './tiers';
import { DRAG_MIME } from './TierBar';
import { FunderRow, funderHref, health } from './types';

export default function FunderCards({
  rows, onTier, onLog, onTask,
}: {
  rows: FunderRow[];
  onTier: (f: FunderRow, tier: TierKey | null) => void;
  onLog: (f: FunderRow) => void;
  onTask: (f: FunderRow) => void;
}) {
  const router = useRouter();
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
      {rows.map(f => {
        const t = TIER_BY_KEY[f.funder_tier];
        const h = health(f.last_touch);
        const due = f.open_tasks ? f.next_task_due : f.next_contact_date;
        return (
          <li key={f.id} draggable role="link" tabIndex={0}
            onDragStart={e => { e.dataTransfer.setData(DRAG_MIME, f.id); e.dataTransfer.effectAllowed = 'move'; }}
            onClick={() => router.push(funderHref(f.id))}
            onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) router.push(funderHref(f.id)); }}
            className="group flex flex-col gap-3 p-3.5 cursor-pointer transition-[box-shadow,border-color] hover:shadow-[var(--shadow-panel)] focus-visible:outline focus-visible:outline-2"
            style={{
              background: 'var(--surface-base)',
              border: '1px solid var(--rule-subtle)',
              borderRadius: 'var(--radius-card)',
              borderLeft: `3px solid ${t ? (t.key === 'unsorted' ? tint(t.color, '66') : t.color) : 'var(--rule-subtle)'}`,
            }}>
            <div className="flex items-start gap-3 min-w-0">
              <span className="relative shrink-0">
                <Avatar name={f.name} size={36} />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full" title={`${h.label} · last contact ${sinceLabel(f.last_touch)}`}
                  style={{ background: h.color, boxShadow: '0 0 0 2px var(--surface-base)' }} />
              </span>
              <div className="flex-1 min-w-0">
                <Link href={funderHref(f.id)} onClick={e => e.stopPropagation()}
                  className="block text-[14px] font-semibold leading-tight truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>
                  {f.name}
                </Link>
                <div className="text-[12px] truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {[f.title, f.org_name].filter(Boolean).join(' · ') || (f.enrichment_status === 'pending' ? <i>Researching online…</i> : '—')}
                </div>
              </div>
              <div onClick={e => e.stopPropagation()} className="shrink-0">
                <TierMenu value={f.funder_tier} onChange={tier => onTier(f, tier)} allowRemove align="right" size="sm" />
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] min-w-0" style={{ color: 'var(--ink-muted)' }}>
              <span className="truncate">{f.last_touch ? `Last contact ${sinceLabel(f.last_touch)}` : 'Not contacted yet'}</span>
              {f.open_tasks > 0 && (
                <span className="flex items-center gap-1 shrink-0" title={`${f.open_tasks} open task${f.open_tasks === 1 ? '' : 's'}`}>
                  <CheckSquare className="w-3 h-3" /><span className="mono-data">{f.open_tasks}</span>
                </span>
              )}
              {due && <span className="shrink-0"><DueChip due={due} /></span>}
              <span className="ml-auto flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={() => onLog(f)} title="Log outreach" aria-label={`Log outreach with ${f.name}`}
                  className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-secondary)' }}>
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => onTask(f)} title="Add a task" aria-label={`Add a task for ${f.name}`}
                  className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-secondary)' }}>
                  <ListPlus className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
