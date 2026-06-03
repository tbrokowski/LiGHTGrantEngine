'use client';
import { useState, useRef, useEffect } from 'react';
import { grants } from '@/lib/api';

interface PriorityConfig {
  value: string;
  label: string;
  bg: string;
  color: string;
  dot: string;
}

const PRIORITIES: PriorityConfig[] = [
  { value: 'urgent', label: 'Urgent', bg: 'var(--state-danger-bg)',  color: 'var(--state-danger)',  dot: 'var(--state-danger)' },
  { value: 'high',   label: 'High',   bg: 'var(--state-warning-bg)', color: 'var(--state-warning)', dot: 'var(--state-warning)' },
  { value: 'medium', label: 'Medium', bg: 'var(--state-warning-bg)', color: 'var(--state-warning)', dot: 'var(--state-warning)' },
  { value: 'low',    label: 'Low',    bg: 'var(--surface-sunken)',   color: 'var(--ink-muted)',     dot: 'var(--ink-faint)' },
];

const PRIORITY_MAP: Record<string, PriorityConfig> = Object.fromEntries(PRIORITIES.map(p => [p.value, p]));

interface PriorityTagProps {
  grantId: string;
  priority: string | null;
  onUpdate?: (priority: string | null) => void;
  readOnly?: boolean;
}

export default function PriorityTag({ grantId, priority, onUpdate, readOnly }: PriorityTagProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  async function handleSelect(value: string | null) {
    if (readOnly) return;
    setOpen(false);
    setSaving(true);
    try {
      await grants.update(grantId, { priority: value });
      onUpdate?.(value);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  const config = priority ? PRIORITY_MAP[priority] : null;
  const label = config?.label ?? priority ?? 'Priority';

  const chipStyle: React.CSSProperties = config
    ? { background: config.bg, color: config.color, border: `1px solid ${config.color}20` }
    : { background: 'var(--surface-sunken)', color: 'var(--ink-faint)', border: '1px dashed var(--rule-strong)' };

  if (readOnly) {
    return priority && config ? (
      <span
        className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
        style={chipStyle}
      >
        {label}
      </span>
    ) : null;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)] transition-opacity"
        style={{ ...chipStyle, opacity: saving ? 0.5 : 1 }}
      >
        {saving ? '…' : label}
        {!saving && (
          <svg className="w-2 h-2 ml-1 opacity-50" viewBox="0 0 10 6" fill="currentColor">
            <path d="M0 0l5 6 5-6H0z" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 py-1 z-20 min-w-[110px]"
          style={{
            border: '1px solid var(--rule-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-panel)',
            boxShadow: 'var(--shadow-floating)',
          }}
        >
          {PRIORITIES.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleSelect(p.value)}
              className="w-full text-left px-3 py-1.5 text-xs font-medium flex items-center gap-2 transition-colors"
              style={{ color: 'var(--ink-secondary)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.dot }} />
              {p.label}
            </button>
          ))}
          {priority && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--ink-faint)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
