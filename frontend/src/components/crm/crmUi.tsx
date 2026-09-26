'use client';
// Small shared pieces of the Partner CRM: avatars, priority bars, the 12-week
// activity strip, due-date chips and group chips. Token colors only, except
// group colors, which are data.

export interface GroupRef { id: string; name: string; color?: string | null }

export interface CrmTask {
  id: string;
  partner_id: string | null;
  group_id: string | null;
  partner_name?: string | null;
  group_name?: string | null;
  group_color?: string | null;
  title: string;
  description?: string | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  due_date?: string | null;
  assigned_to?: string | null;
  assignee_name?: string | null;
}

const TINTS = ['#E6F0EE', '#E8ECFA', '#FBEDE6', '#EFEAFB', '#E7F3EA', '#F9E7EC', '#EEF0F3'];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const tint = TINTS[(name.charCodeAt(0) + name.charCodeAt(name.length - 1 || 0)) % TINTS.length];
  return (
    <span
      aria-hidden
      className="rounded-full flex items-center justify-center shrink-0 font-semibold"
      style={{ width: size, height: size, background: tint, color: 'var(--ink-secondary)', fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}

export const PRIORITY_LABEL: Record<number, string> = { 1: 'Regular', 2: 'Medium', 3: 'High' };

function barColor(p: number) {
  return p === 3 ? 'var(--state-warning)' : p === 2 ? 'var(--ink-secondary)' : 'var(--ink-muted)';
}

/** Three ascending bars; filled up to the priority. Clickable when onChange is given. */
export function PriorityBars({ value, onChange, size = 'md' }: { value: number; onChange?: (p: number) => void; size?: 'sm' | 'md' }) {
  const heights = size === 'sm' ? [5, 8, 11] : [6, 10, 14];
  const label = `Priority ${value} · ${PRIORITY_LABEL[value] ?? ''}`;
  const bars = heights.map((h, i) => {
    const on = i < value;
    const style = { width: 5, height: h, borderRadius: 1.5, background: on ? barColor(value) : 'var(--rule-subtle)' };
    return onChange ? (
      <button
        key={i}
        type="button"
        onClick={e => { e.stopPropagation(); e.preventDefault(); onChange(i + 1); }}
        aria-label={`Set priority ${i + 1} · ${PRIORITY_LABEL[i + 1]}`}
        className="flex items-end h-full px-px"
        style={{ cursor: 'pointer' }}
      >
        <span style={style} />
      </button>
    ) : <span key={i} style={style} />;
  });
  return (
    <span className="inline-flex items-end gap-0.5" style={{ height: heights[2] }} title={label} aria-label={onChange ? undefined : label} role={onChange ? 'group' : undefined}>
      {bars}
    </span>
  );
}

/** Priority as a pill switch (used on the person page). */
export function PrioritySwitch({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  return (
    <div role="group" aria-label="Priority" className="flex gap-1">
      {[1, 2, 3].map(p => {
        const on = value === p;
        const high = on && p === 3;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(p)}
            className="text-xs font-medium px-2.5 h-[26px] rounded-full transition-colors"
            style={{
              border: `1px solid ${on ? (high ? 'var(--state-warning)' : 'var(--ink-secondary)') : 'var(--rule-subtle)'}`,
              background: on ? (high ? 'var(--state-warning-bg)' : 'var(--surface-sunken)') : 'var(--surface-base)',
              color: on ? (high ? 'var(--state-warning)' : 'var(--ink-primary)') : 'var(--ink-muted)',
            }}
          >
            P{p} · {PRIORITY_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

const WEEK_SHADES = ['var(--rule-subtle)', 'var(--rule-strong)', 'var(--ink-muted)', 'var(--ink-primary)'];

/** 12 small cells, one per week, shaded by how many touches happened. */
export function WeekStrip({ weeks, cell = 5, height = 12 }: { weeks: number[]; cell?: number; height?: number }) {
  const total = weeks.reduce((a, b) => a + b, 0);
  return (
    <span className="inline-flex gap-0.5" title={`${total} touch${total === 1 ? '' : 'es'} in the last 12 weeks`}>
      {weeks.map((n, i) => (
        <span key={i} style={{ width: cell, height, borderRadius: 1.5, background: WEEK_SHADES[Math.min(n, 3)] }} />
      ))}
    </span>
  );
}

export function GroupChip({ group, size = 'sm' }: { group: GroupRef; size?: 'sm' | 'md' }) {
  const color = group.color || 'var(--ink-muted)';
  return (
    <span className={`inline-flex items-center gap-1 ${size === 'md' ? 'text-xs font-medium' : 'text-[11px]'}`} style={{ color }}>
      <span style={{ width: size === 'md' ? 8 : 7, height: size === 'md' ? 8 : 7, borderRadius: 2, background: color }} />
      {group.name}
    </span>
  );
}

export function TagPill({ label }: { label: string }) {
  const facet = label.startsWith('need:') ? 'need' : null;
  return (
    <span
      className="text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{
        background: facet === 'need' ? 'var(--state-warning-bg)' : 'var(--surface-sunken)',
        color: facet === 'need' ? 'var(--state-warning)' : 'var(--ink-secondary)',
      }}
    >
      {facet ? `${facet}: ${label.slice(5)}` : label}
    </span>
  );
}

const DAY = 86_400_000;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** Due chip text + tone: overdue (danger), today (warning), within 3 days (neutral), later (plain). */
export function dueInfo(due?: string | null, done = false): { label: string; tone: 'over' | 'today' | 'soon' | 'later' | 'none' } {
  if (done) return { label: 'Done', tone: 'later' };
  if (!due) return { label: 'No date', tone: 'none' };
  const d = new Date(due);
  const days = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY);
  if (days < 0) return { label: `Overdue ${-days}d`, tone: 'over' };
  if (days === 0) return { label: 'Today', tone: 'today' };
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, tone: days <= 3 ? 'soon' : 'later' };
}

export function DueChip({ due, done }: { due?: string | null; done?: boolean }) {
  const { label, tone } = dueInfo(due, done);
  const style = {
    over: { color: 'var(--state-danger)', background: 'var(--state-danger-bg)' },
    today: { color: 'var(--state-warning)', background: 'var(--state-warning-bg)' },
    soon: { color: 'var(--ink-secondary)', background: 'var(--surface-sunken)' },
    later: { color: 'var(--ink-muted)', background: 'transparent' },
    none: { color: 'var(--ink-faint)', background: 'transparent' },
  }[tone];
  return <span className="mono-data text-[11px] px-1.5 py-0.5 rounded-[var(--radius-sm)] whitespace-nowrap" style={style}>{label}</span>;
}

/** "today", "3 days ago", "5 weeks ago", or "never". */
export function sinceLabel(iso?: string | null) {
  if (!iso) return 'no contact';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 21) return `${days} days ago`;
  if (days < 90) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export const GROUP_COLORS = ['#0F766E', '#1D4ED8', '#C2410C', '#6D28D9', '#15803D', '#BE123C', '#475569', '#A16207'];

export const card: React.CSSProperties = {
  background: 'var(--surface-base)',
  border: '1px solid var(--rule-subtle)',
  borderRadius: 'var(--radius-card)',
};

export const btnPrimary: React.CSSProperties = {
  background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-md)',
};

export const btnOutline: React.CSSProperties = {
  background: 'var(--surface-base)', color: 'var(--ink-primary)', border: '1px solid var(--rule-strong)', borderRadius: 'var(--radius-md)',
};

export const btnQuiet: React.CSSProperties = {
  background: 'var(--surface-base)', color: 'var(--ink-secondary)', border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)',
};

export function Segmented<T extends string | number>({
  options, value, onChange, label,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex p-[3px] rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)' }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className="h-7 px-2.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors"
            style={{
              background: on ? 'var(--surface-base)' : 'transparent',
              color: on ? 'var(--ink-primary)' : 'var(--ink-muted)',
              boxShadow: on ? 'var(--shadow-panel)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
