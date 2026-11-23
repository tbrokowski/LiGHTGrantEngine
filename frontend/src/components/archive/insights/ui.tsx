'use client';
/**
 * Small Ledger Console primitives shared by the Archive Insights panels.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Chart chrome (light only — the app has no dark theme).
export const CHART = {
  series: '#2a78d6',
  up: '#2a78d6',
  down: '#e34948',
  grid: '#E5E4DF',
  axis: '#C8C7BF',
  tick: '#87867F',
  ink: '#3A3A36',
  band: 'rgba(42, 120, 214, 0.14)',
  font: 11,
};

export const inputStyle: CSSProperties = {
  border: '1px solid var(--rule-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  color: 'var(--ink-primary)',
  outline: 'none',
};

export function Segmented<T extends string>({
  value, options, onChange, size = 'md', ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 p-0.5"
      style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--rule-subtle)' }}
    >
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'} font-medium whitespace-nowrap transition-colors`}
            style={{
              borderRadius: 'calc(var(--radius-sm) - 2px)',
              background: active ? 'var(--surface-raised)' : 'transparent',
              color: active ? 'var(--ink-primary)' : 'var(--ink-muted)',
              boxShadow: active ? 'var(--shadow-panel)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A trigger plus a floating panel. Owns its open state; closes on Escape or a
 * click outside both the trigger and the panel.
 */
export function Menu({
  button, children, align = 'right', placement = 'bottom', width = 280, block = false,
}: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right' | 'stretch';
  placement?: 'bottom' | 'top';
  width?: number;
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const pos = [
    placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
    align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-0 right-0',
  ].join(' ');
  return (
    <div ref={ref} className={`relative ${block ? 'block' : 'inline-block'}`}>
      {button(open, () => setOpen(o => !o))}
      {open && (
        <div
          className={`absolute z-40 ${pos}`}
          style={{
            width: align === 'stretch' ? undefined : width,
            background: 'var(--surface-panel)',
            border: '1px solid var(--rule-subtle)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-floating)',
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function TagDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

export function TagChip({ name, color, group, onRemove, small }: {
  name: string; color: string; group?: string; onRemove?: () => void; small?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${small ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]'} font-medium max-w-full`}
      style={{ border: '1px solid var(--rule-subtle)', borderRadius: 999, color: 'var(--ink-secondary)', background: 'var(--surface-raised)' }}
      title={group ? `${group}: ${name}` : name}
    >
      <TagDot color={color} size={small ? 6 : 7} />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="-mr-0.5" style={{ color: 'var(--ink-faint)' }}>
          ×
        </button>
      )}
    </span>
  );
}

export function SectionHeader({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>{title}</h3>
        {hint && <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>{hint}</p>}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, emphasis }: { label: string; value: ReactNode; sub?: ReactNode; emphasis?: boolean }) {
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="ledger-label truncate">{label}</div>
      <div
        className={`mono-data tabular-nums mt-1 truncate ${emphasis ? 'text-[22px]' : 'text-[18px]'} font-semibold`}
        style={{ color: 'var(--ink-primary)', letterSpacing: '-0.01em' }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>{sub}</div>}
    </div>
  );
}

export function ChartTooltipBox({ title, rows }: { title: ReactNode; rows: { label: ReactNode; value: ReactNode; color?: string }[] }) {
  return (
    <div
      className="px-3 py-2 text-[11px] min-w-[160px]"
      style={{ background: 'var(--surface-panel)', border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-floating)' }}
    >
      <div className="font-semibold mb-1" style={{ color: 'var(--ink-primary)' }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-px">
          <span className="flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
            {r.color && <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="mono-data tabular-nums" style={{ color: 'var(--ink-primary)' }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function GhostButton({ children, onClick, disabled, title, active }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40"
      style={{
        border: '1px solid var(--rule-subtle)',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
        background: active ? 'var(--selection-bg)' : 'var(--surface-raised)',
      }}
    >
      {children}
    </button>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>{children}</p>;
}
