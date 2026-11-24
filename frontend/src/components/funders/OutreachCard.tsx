'use client';
// Outreach: the latest emails, calls and meetings logged with funders.
import { useState } from 'react';
import Link from 'next/link';
import { Mail, MessageSquare, Phone, Plus, StickyNote, Users } from 'lucide-react';
import { btnPrimary, card } from '@/components/crm/crmUi';
import { TIER_BY_KEY } from './tiers';
import { funderHref } from './types';

export interface OutreachItem {
  id: string;
  partner_id: string;
  partner_name: string;
  funder_tier: string;
  user_name?: string | null;
  content: string;
  update_type: string;
  contact_date?: string | null;
  created_at?: string | null;
}

const KINDS: Record<string, { label: string; Icon: typeof Mail }> = {
  email: { label: 'Email', Icon: Mail },
  call: { label: 'Call', Icon: Phone },
  meeting: { label: 'Meeting', Icon: Users },
  note: { label: 'Note', Icon: StickyNote },
};

const SHOWN = 5;

function when(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) });
}

export default function OutreachCard({ items, onLog }: { items: OutreachItem[] | null; onLog: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items?.slice(0, SHOWN);

  return (
    <div className="flex flex-col min-w-0" style={card}>
      <div className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
          Outreach <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{items?.length || ''}</span>
        </h2>
        <button type="button" onClick={onLog} className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium" style={btnPrimary}>
          <Plus className="w-3.5 h-3.5" />Log outreach
        </button>
      </div>
      <ul>
        {items === null && Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="px-[18px] py-3" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
            <div className="h-4 w-2/3 animate-pulse rounded" style={{ background: 'var(--surface-sunken)' }} />
          </li>
        ))}
        {shown?.map(o => {
          const k = KINDS[o.update_type] ?? { label: 'Outreach', Icon: MessageSquare };
          const tier = TIER_BY_KEY[o.funder_tier];
          return (
            <li key={o.id} className="flex items-start gap-3 px-[18px] py-2.5" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
              <span className="mt-0.5 w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }} title={k.label}>
                <k.Icon className="w-3.5 h-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <Link href={funderHref(o.partner_id)} className="text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>
                    {o.partner_name}
                  </Link>
                  {tier && <span aria-label={tier.one} title={tier.one} className="text-[12px] leading-none">{tier.emoji}</span>}
                  <span className="hidden sm:inline text-[11px] shrink-0" style={{ color: 'var(--ink-muted)' }}>· {k.label}{o.user_name ? ` by ${o.user_name.split(' ')[0]}` : ''}</span>
                </div>
                <p className="text-[12px] leading-snug line-clamp-2 mt-0.5" style={{ color: 'var(--ink-secondary)' }}>{o.content}</p>
              </div>
              <span className="mono-data text-[11px] shrink-0 mt-0.5" style={{ color: 'var(--ink-muted)' }}>{when(o.contact_date || o.created_at)}</span>
            </li>
          );
        })}
        {items && !items.length && (
          <li className="px-[18px] py-8 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
            No outreach logged yet.
          </li>
        )}
      </ul>
      {(items?.length ?? 0) > SHOWN && (
        <button type="button" onClick={() => setAll(v => !v)} className="mt-auto px-[18px] py-2.5 text-left text-[13px] hover:bg-[var(--surface-sunken)]"
          style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
          {all ? 'Show fewer' : `Show all ${items!.length}`}
        </button>
      )}
    </div>
  );
}
