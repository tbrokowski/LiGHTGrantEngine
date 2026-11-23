'use client';
// By-tier view: one pod per tier, grouped into zones. Drag a card onto another
// pod (or use its tier menu) to move the person.
import { useState } from 'react';
import Link from 'next/link';
import { CheckSquare, MessageSquarePlus, Plus } from 'lucide-react';
import { Avatar, PriorityBars, card, sinceLabel } from '@/components/crm/crmUi';
import { TIERS, Tier, TierKey, TierMark, TierMenu, ZONES, tint } from './tiers';
import { FunderRow, funderHref, health } from './types';

const DRAG_MIME = 'application/x-funder-id';

export default function FunderBoard({
  rows, showEmpty, onTier, onLog, onAdd,
}: {
  rows: FunderRow[];
  showEmpty: boolean;
  onTier: (f: FunderRow, tier: TierKey | null) => void;
  onLog: (f: FunderRow) => void;
  onAdd: (tier: TierKey) => void;
}) {
  const [over, setOver] = useState<TierKey | null>(null);
  const byTier = new Map<TierKey, FunderRow[]>();
  for (const f of rows) byTier.set(f.funder_tier, [...(byTier.get(f.funder_tier) ?? []), f]);

  function drop(tier: TierKey, e: React.DragEvent) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_MIME);
    const f = rows.find(r => r.id === id);
    if (f && f.funder_tier !== tier) onTier(f, tier);
  }

  const pod = (t: Tier, wide = false) => {
    const people = byTier.get(t.key) ?? [];
    if (!people.length && !showEmpty) return null;
    const isOver = over === t.key;
    return (
      <section key={t.key}
        onDragOver={e => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(t.key); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
        onDrop={e => drop(t.key, e)}
        className="flex flex-col min-w-0 overflow-hidden transition-shadow"
        style={{
          ...card,
          borderColor: isOver ? t.color : 'var(--rule-subtle)',
          boxShadow: isOver ? `0 0 0 3px ${tint(t.color, '2A')}` : undefined,
        }}
        aria-label={`${t.label}: ${people.length}`}>
        <header className="flex items-start gap-3 px-4 pt-3.5 pb-3"
          style={{ background: `linear-gradient(180deg, ${tint(t.color, '10')}, transparent)`, borderTop: `3px solid ${t.color}` }}>
          <TierMark tier={t} size={36} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>{t.label}</h3>
              <span className="mono-data text-xs" style={{ color: t.key === 'unsorted' ? 'var(--ink-muted)' : t.color }}>{people.length}</span>
            </div>
            <p className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--ink-muted)' }}>{t.blurb}</p>
          </div>
          <button type="button" onClick={() => onAdd(t.key)} aria-label={`Add to ${t.label}`} title={`Add to ${t.label}`}
            className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-muted)' }}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        </header>
        <ul className={wide ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4' : 'flex flex-col'}>
          {people.map(f => {
            const h = health(f.last_touch);
            return (
              <li key={f.id} draggable
                onDragStart={e => { e.dataTransfer.setData(DRAG_MIME, f.id); e.dataTransfer.effectAllowed = 'move'; }}
                className="group flex items-center gap-2.5 px-4 py-2.5 cursor-grab active:cursor-grabbing hover:bg-[var(--selection-bg)]"
                style={{ borderTop: '1px solid var(--rule-subtle)' }}>
                <span className="relative shrink-0">
                  <Avatar name={f.name} size={30} />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" title={`${h.label} · last contact ${sinceLabel(f.last_touch)}`}
                    style={{ background: h.color, boxShadow: '0 0 0 2px var(--surface-base)' }} />
                </span>
                <div className="flex-1 min-w-0">
                  <Link href={funderHref(f.id)} className="block text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{f.name}</Link>
                  <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                    {[f.title, f.org_name].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                {f.open_tasks > 0 && (
                  <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full shrink-0" title={`${f.open_tasks} open task${f.open_tasks === 1 ? '' : 's'}`}
                    style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)' }}>
                    <CheckSquare className="w-3 h-3" /><span className="mono-data">{f.open_tasks}</span>
                  </span>
                )}
                <PriorityBars value={f.priority} size="sm" />
                <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button type="button" onClick={() => onLog(f)} aria-label={`Log a touch with ${f.name}`} title="Log a touch"
                    className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-secondary)' }}>
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                  </button>
                  <TierMenu value={null} onChange={tier => onTier(f, tier)} align="right"
                    placeholder={<span className="text-[11px] pl-1" style={{ color: 'var(--ink-muted)' }}>Move</span>} />
                </div>
              </li>
            );
          })}
          {!people.length && (
            <li className="mx-4 mb-3 mt-1 py-4 text-center text-[12px] rounded-[var(--radius-md)]"
              style={{ border: `1px dashed ${isOver ? t.color : 'var(--rule-strong)'}`, color: 'var(--ink-faint)' }}>
              Drop someone here
            </li>
          )}
        </ul>
      </section>
    );
  };

  const unsorted = TIERS.find(t => t.key === 'unsorted')!;
  const unsortedCount = byTier.get('unsorted')?.length ?? 0;

  return (
    <div className="flex flex-col gap-7">
      {unsortedCount > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>Waiting for a tier</h2>
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Drag each person to where they belong, or use Move.</span>
          </div>
          {pod(unsorted, true)}
        </div>
      )}
      {ZONES.map(z => {
        const tiers = TIERS.filter(t => t.zone === z.key);
        const count = tiers.reduce((n, t) => n + (byTier.get(t.key)?.length ?? 0), 0);
        if (!count && !showEmpty) return null;
        return (
          <div key={z.key} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>{z.label}</h2>
              <span className="mono-data text-xs" style={{ color: 'var(--ink-muted)' }}>{count}</span>
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>· {z.blurb}</span>
            </div>
            <div className={`grid grid-cols-1 gap-4 items-start ${tiers.length > 3 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>{tiers.map(t => pod(t))}</div>
          </div>
        );
      })}
    </div>
  );
}
