'use client';
// Funder tiers — the whale scale the LiGHT team uses to sort funders. Order and
// keys mirror app/services/funders.py FUNDER_TIERS. Tier colors are data (like
// group colors), so they're hex rather than tokens.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { card } from '@/components/crm/crmUi';

export type TierKey =
  | 'blue_whale' | 'whale_pod' | 'whale_calf' | 'matriarch'
  | 'sperm_whale' | 'humpback_whale' | 'orca'
  | 'dolphin' | 'pilot_fish' | 'shark'
  | 'unsorted';

export interface Tier {
  key: TierKey;
  label: string;
  /** Singular, for a person: "Blue Whale". */
  one: string;
  emoji: string;
  blurb: string;
  color: string;
  zone: ZoneKey;
  /** Emoji scale inside its badge (calves are smaller). */
  scale?: number;
}

export type ZoneKey = 'holders' | 'investors' | 'advisors' | 'unsorted';

export const ZONES: { key: ZoneKey; label: string; blurb: string }[] = [
  { key: 'holders', label: 'Wealth holders', blurb: 'The people and families who hold the capital' },
  { key: 'investors', label: 'Investors & philanthropists', blurb: 'Those who deploy it, in markets and in giving' },
  { key: 'advisors', label: 'Advisors & dealmakers', blurb: 'The people around the money who open doors' },
];

export const TIERS: Tier[] = [
  { key: 'blue_whale', label: 'Blue Whales', one: 'Blue Whale', emoji: '🐋', blurb: 'Billionaires / ultra-high-net-worth individuals', color: '#1E3A8A', zone: 'holders' },
  { key: 'whale_pod', label: 'Whale Pods', one: 'Whale Pod', emoji: '🐳', blurb: 'Wealthy families / family dynasties', color: '#1D4ED8', zone: 'holders' },
  { key: 'whale_calf', label: 'Whale Calves', one: 'Whale Calf', emoji: '🐋', blurb: 'Next-generation wealth holders / heirs', color: '#0284C7', zone: 'holders', scale: 0.72 },
  { key: 'matriarch', label: 'Matriarchs', one: 'Matriarch', emoji: '🐳', blurb: 'Family patriarchs / matriarchs', color: '#6D28D9', zone: 'holders' },
  { key: 'sperm_whale', label: 'Sperm Whales', one: 'Sperm Whale', emoji: '🐋', blurb: 'Highly concentrated, sophisticated investors', color: '#475569', zone: 'investors' },
  { key: 'humpback_whale', label: 'Humpback Whales', one: 'Humpback Whale', emoji: '🐋', blurb: 'High-profile philanthropists', color: '#0F766E', zone: 'investors' },
  { key: 'orca', label: 'Orcas', one: 'Orca', emoji: '🐋', blurb: 'Activist investors / strategic philanthropists', color: '#18181B', zone: 'investors' },
  { key: 'dolphin', label: 'Dolphins', one: 'Dolphin', emoji: '🐬', blurb: 'Wealth advisors / philanthropic advisors', color: '#0891B2', zone: 'advisors' },
  { key: 'pilot_fish', label: 'Pilot Fish', one: 'Pilot Fish', emoji: '🐟', blurb: 'Family office executives / wealth managers', color: '#A16207', zone: 'advisors' },
  { key: 'shark', label: 'Sharks', one: 'Shark', emoji: '🦈', blurb: 'Fundraisers / investment bankers / dealmakers', color: '#BE123C', zone: 'advisors' },
  { key: 'unsorted', label: 'To sort', one: 'To sort', emoji: '🫧', blurb: 'Added, but no tier picked yet', color: '#87867F', zone: 'unsorted' },
];

export const TIER_BY_KEY: Record<string, Tier> = Object.fromEntries(TIERS.map(t => [t.key, t]));
export const tierRank = (k?: string | null) => {
  const i = TIERS.findIndex(t => t.key === k);
  return i < 0 ? TIERS.length : i;
};

/** 8-digit hex: the tier color at low alpha, for tinted backgrounds. */
export const tint = (hex: string, alpha = '14') => `${hex}${alpha}`;

/** The tier's emoji in a soft circle of its color. */
export function TierMark({ tier, size = 28 }: { tier: Tier; size?: number }) {
  return (
    <span aria-hidden className="shrink-0 inline-flex items-center justify-center rounded-full"
      style={{ width: size, height: size, background: tint(tier.color, '1F'), boxShadow: `inset 0 0 0 1px ${tint(tier.color, '33')}` }}>
      <span style={{ fontSize: Math.round(size * 0.56 * (tier.scale ?? 1)), lineHeight: 1 }}>{tier.emoji}</span>
    </span>
  );
}

/** Compact tier pill: emoji + name, tinted in the tier color. */
export function TierPill({ tierKey, size = 'md' }: { tierKey?: string | null; size?: 'sm' | 'md' }) {
  const t = TIER_BY_KEY[tierKey ?? ''];
  if (!t) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full whitespace-nowrap font-medium ${size === 'sm' ? 'text-[11px] px-1.5 py-px' : 'text-xs px-2 py-0.5'}`}
      style={{ background: tint(t.color, '14'), color: t.key === 'unsorted' ? 'var(--ink-muted)' : t.color }}>
      <span aria-hidden style={{ fontSize: size === 'sm' ? 11 : 12, lineHeight: 1 }}>{t.emoji}</span>{t.one}
    </span>
  );
}

/** A tier pill that opens a menu to move the person (or take them off Funders). */
export function TierMenu({
  value, onChange, allowRemove = false, align = 'left', placeholder, size = 'md',
}: {
  value?: string | null;
  onChange: (tier: TierKey | null) => void;
  allowRemove?: boolean;
  align?: 'left' | 'right';
  placeholder?: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const MENU_W = 300;

  // The menu floats in a portal so table and card overflow can't clip it.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(align === 'right' ? r.right - MENU_W : r.left, window.innerWidth - MENU_W - 8));
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    setPos(below >= 320 || below >= above
      ? { left, top: r.bottom + 4, maxH: Math.min(420, below - 4) }
      : { left, bottom: window.innerHeight - r.top + 4, maxH: Math.min(420, above - 4) });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const away = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  return (
    <div className="relative inline-flex">
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open}
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        className="inline-flex items-center gap-0.5 rounded-full focus-visible:outline focus-visible:outline-2"
        title="Change funder tier">
        {value ? <TierPill tierKey={value} size={size} /> : placeholder}
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--ink-muted)' }} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} role="menu" className="fixed z-[60] py-1 overflow-y-auto"
          style={{ ...card, boxShadow: 'var(--shadow-floating)', width: MENU_W, left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
          onClick={e => e.stopPropagation()}>
          {[...ZONES, { key: 'unsorted' as ZoneKey, label: '', blurb: '' }].map(z => (
            <div key={z.key}>
              {z.label && <div className="ledger-label px-3 pt-2 pb-1">{z.label}</div>}
              {TIERS.filter(t => t.zone === z.key).map(t => (
                <button key={t.key} type="button" role="menuitemradio" aria-checked={value === t.key}
                  onClick={e => { e.preventDefault(); setOpen(false); if (t.key !== value) onChange(t.key); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[var(--surface-sunken)]">
                  <TierMark tier={t} size={24} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium" style={{ color: 'var(--ink-primary)' }}>{t.label}</span>
                    <span className="block text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{t.blurb}</span>
                  </span>
                  {value === t.key && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ink-primary)' }} />}
                </button>
              ))}
            </div>
          ))}
          {allowRemove && value && (
            <button type="button" role="menuitem" onClick={e => { e.preventDefault(); setOpen(false); onChange(null); }}
              className="w-full px-3 py-2 mt-1 text-left text-xs hover:bg-[var(--surface-sunken)]"
              style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--state-danger)' }}>
              Remove from Funders (stays in Partners)
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
