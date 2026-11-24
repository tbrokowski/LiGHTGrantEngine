'use client';
// One sliding row of tiers, Blue Whales to Sharks. Pick one to see its people
// below; drop a person's card on a tier to move them there.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TIERS, TierKey, TierMark, tint } from './tiers';

export const DRAG_MIME = 'application/x-funder-id';

export default function TierBar({
  counts, total, active, onSelect, onDropPerson,
}: {
  counts: Map<TierKey, number>;
  total: number;
  active: TierKey | null;
  onSelect: (t: TierKey | null) => void;
  onDropPerson: (id: string, tier: TierKey) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const [over, setOver] = useState<TierKey | null>(null);

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Keep the chosen tier in view (e.g. when it was restored from last visit).
  useEffect(() => {
    rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const slide = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.75, behavior: 'smooth' });

  const item = (key: TierKey | null) => {
    const t = key ? TIERS.find(x => x.key === key)! : null;
    const on = active === key;
    const color = t?.color ?? 'var(--ink-primary)';
    const n = key ? counts.get(key) ?? 0 : total;
    const dropTarget = !!key && over === key;
    return (
      <button key={key ?? 'all'} type="button" aria-pressed={on} onClick={() => onSelect(key)}
        title={t?.blurb ?? 'Everyone on the Funders tab'}
        onDragOver={key ? e => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(key); } } : undefined}
        onDragLeave={key ? () => setOver(o => (o === key ? null : o)) : undefined}
        onDrop={key ? e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData(DRAG_MIME); if (id) onDropPerson(id, key); } : undefined}
        className="snap-start shrink-0 w-[146px] flex flex-col items-start gap-2 px-3 pt-3 pb-2.5 text-left transition-[box-shadow,background,border-color]"
        style={{
          borderRadius: 'var(--radius-card)',
          border: `1px solid ${on || dropTarget ? (t?.color ?? 'var(--ink-secondary)') : 'var(--rule-subtle)'}`,
          background: on ? (t ? tint(t.color, '12') : 'var(--surface-sunken)') : 'var(--surface-base)',
          boxShadow: dropTarget ? `0 0 0 3px ${tint(t!.color, '2E')}` : on ? `inset 0 -3px 0 ${color}` : undefined,
          opacity: n || on || !key ? 1 : 0.6,
        }}>
        <div className="w-full flex items-center justify-between">
          {t ? <TierMark tier={t} size={30} /> : (
            <span aria-hidden className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full text-[16px]" style={{ background: 'var(--surface-sunken)' }}>🌊</span>
          )}
          <span className="mono-data text-[18px] font-semibold leading-none" style={{ color: n ? (t && t.key !== 'unsorted' ? t.color : 'var(--ink-primary)') : 'var(--ink-faint)' }}>{n}</span>
        </div>
        <span className="text-[12px] font-semibold leading-tight truncate w-full" style={{ color: on ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}>
          {t?.label ?? 'All funders'}
        </span>
      </button>
    );
  };

  const arrow = (dir: 1 | -1) => {
    const show = dir < 0 ? edge.left : edge.right;
    const Icon = dir < 0 ? ChevronLeft : ChevronRight;
    return (
      <button type="button" aria-label={dir < 0 ? 'Earlier tiers' : 'More tiers'} onClick={() => slide(dir)} tabIndex={show ? 0 : -1}
        className={`hidden md:flex absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full transition-opacity ${dir < 0 ? '-left-3' : '-right-3'}`}
        style={{ background: 'var(--surface-base)', border: '1px solid var(--rule-strong)', boxShadow: 'var(--shadow-panel)', color: 'var(--ink-secondary)', opacity: show ? 1 : 0, pointerEvents: show ? 'auto' : 'none' }}>
        <Icon className="w-4 h-4" />
      </button>
    );
  };

  return (
    <div className="relative">
      {arrow(-1)}
      <div ref={rail} onScroll={measure} role="group" aria-label="Funder tiers"
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory scroll-px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: `linear-gradient(90deg, ${edge.left ? 'transparent' : '#000'} 0, #000 28px, #000 calc(100% - 28px), ${edge.right ? 'transparent' : '#000'} 100%)`,
          WebkitMaskImage: `linear-gradient(90deg, ${edge.left ? 'transparent' : '#000'} 0, #000 28px, #000 calc(100% - 28px), ${edge.right ? 'transparent' : '#000'} 100%)`,
        }}>
        {item(null)}
        {TIERS.map(t => item(t.key))}
      </div>
      {arrow(1)}
    </div>
  );
}
