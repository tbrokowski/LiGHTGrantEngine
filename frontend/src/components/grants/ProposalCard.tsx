'use client';
import { useState } from 'react';
import Link from 'next/link';
import PriorityTag from './PriorityTag';
import StageTransitionModal from './StageTransitionModal';

export interface GrantSummary {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  priority: string | null;
  grant_stage: string;
  external_deadline: string | null;
  internal_deadline: string | null;
  submitted_at: string | null;
  decision_at: string | null;
  pi_name: string | null;
  themes: string[];
  is_personal: boolean;
  program: string | null;
  requested_amount: number | null;
  currency: string | null;
  award_amount: number | null;
  tasks?: { status: string }[];
  color?: string | null;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function DeadlineChip({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return null;
  const days = daysUntil(dateStr);
  const label = formatDate(dateStr);
  if (days === null) return null;

  let inkColor = 'var(--ink-faint)';
  let dotColor = 'var(--ink-faint)';
  let badge = '';
  if (days < 0) { inkColor = 'var(--ink-faint)'; dotColor = 'var(--ink-faint)'; }
  else if (days <= 7)  { inkColor = 'var(--state-danger)';  dotColor = 'var(--state-danger)';  badge = `${days}d`; }
  else if (days <= 14) { inkColor = 'var(--state-warning)'; dotColor = 'var(--state-warning)'; badge = `${days}d`; }
  else if (days <= 30) { inkColor = 'var(--state-warning)'; dotColor = 'var(--state-warning)'; }

  return (
    <div className="flex items-center gap-1.5 mono-data text-[11px]" style={{ color: inkColor }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
      <span className="whitespace-nowrap">{label}</span>
      {badge && (
        <span
          className="text-[10px] font-semibold px-1 py-px rounded-[var(--radius-xs)]"
          style={{ background: days <= 7 ? 'var(--state-danger-bg)' : 'var(--state-warning-bg)' }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function TaskProgress({ tasks }: { tasks?: { status: string }[] }) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === 'completed').length;
  const pct = Math.round((done / tasks.length) * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-0.5 w-20 overflow-hidden"
        style={{ background: 'var(--rule-subtle)', borderRadius: 'var(--radius-xs)' }}
      >
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: pct === 100 ? 'var(--accent-cool)' : 'var(--accent-primary)',
            borderRadius: 'var(--radius-xs)',
          }}
        />
      </div>
      <span className="mono-data text-[10px]" style={{ color: 'var(--ink-faint)' }}>
        {done}/{tasks.length}
      </span>
    </div>
  );
}

function formatAmount(amount: number | null, currency: string | null) {
  if (!amount) return null;
  const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return `${currency ?? '$'}${fmt.format(amount)}`;
}

interface Props {
  grant: GrantSummary;
  onStageChange: (id: string, newStage: string) => void;
  onDelete: (id: string) => void;
}

export default function ProposalCard({ grant, onStageChange, onDelete }: Props) {
  const [priority, setPriority] = useState(grant.priority);
  const [transition, setTransition] = useState<'submit' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isPersonal = grant.is_personal;
  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);
  const amountLabel = formatAmount(grant.requested_amount, grant.currency);
  const themes = (grant.themes ?? []).slice(0, 2);

  // Color accent — use grant color if set, else the institutional navy
  const accentColor = grant.color ?? 'var(--rule-subtle)';

  return (
    <>
      {transition && (
        <StageTransitionModal
          grantId={grant.id}
          grantTitle={grant.title}
          transitionType={transition}
          onClose={() => setTransition(null)}
          onSuccess={(stage) => { setTransition(null); onStageChange(grant.id, stage); }}
        />
      )}
      <div
        className="group flex items-stretch transition-colors duration-100"
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Left color accent bar */}
        <div
          className="w-1 shrink-0 self-stretch"
          style={{ background: accentColor, minHeight: '60px' }}
        />

        {/* Main content */}
        <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0 px-5 py-4">
          {/* Top row: priority + meta chips */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <PriorityTag grantId={grant.id} priority={priority} onUpdate={setPriority} />
            {isPersonal && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}
              >
                Personal
              </span>
            )}
          </div>

          {/* Title */}
          <h3
            className="text-sm font-medium leading-snug transition-colors duration-100"
            style={{ color: 'var(--ink-primary)' }}
          >
            {grant.title}
          </h3>

          {/* Meta row */}
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            {meta.length > 0 && (
              <p className="mono-data text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                {meta.join('  ·  ')}
              </p>
            )}
            {amountLabel && (
              <span className="mono-data text-[11px] font-medium" style={{ color: 'var(--accent-warm)' }}>
                {amountLabel}
              </span>
            )}
          </div>

          {/* Bottom row: deadline + tasks + themes */}
          <div className="mt-2 flex items-center gap-4 flex-wrap">
            <DeadlineChip dateStr={grant.external_deadline} />
            <TaskProgress tasks={grant.tasks} />
            {themes.map(theme => (
              <span
                key={theme}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
              >
                {theme}
              </span>
            ))}
          </div>
        </Link>

        {/* Right: actions */}
        <div className="flex flex-col items-end justify-between gap-2 px-4 py-4 shrink-0">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(v => !v)}
              className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] transition-colors"
              style={{ color: 'var(--ink-faint)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'var(--surface-sunken)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink-faint)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-44 py-1 z-10"
                style={{
                  border: '1px solid var(--rule-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-panel)',
                  boxShadow: 'var(--shadow-floating)',
                }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setTransition('submit'); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--ink-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Mark as Submitted
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onDelete(grant.id); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--ink-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          <Link
            href={`/grants/${grant.id}?tab=editor`}
            className="text-xs font-medium px-2.5 py-1 transition-colors"
            style={{
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-secondary)',
              color: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary)',
              opacity: 0.8,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
          >
            Write
          </Link>
        </div>
      </div>
    </>
  );
}
