'use client';
import { useState } from 'react';
import Link from 'next/link';
import PriorityTag from './PriorityTag';
import CardMenu, { MenuItem, MenuLink } from './CardMenu';
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
  call_url?: string | null;
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
            background: 'var(--accent-primary)',
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
  onEdit?: (grant: GrantSummary) => void;
}

export default function ProposalCard({ grant, onStageChange, onDelete, onEdit }: Props) {
  const [priority, setPriority] = useState(grant.priority);
  const [transition, setTransition] = useState<'submit' | null>(null);

  const isPersonal = grant.is_personal;
  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);
  const amountLabel = formatAmount(grant.requested_amount, grant.currency);
  const themes = (grant.themes ?? []).slice(0, 2);

  const accentColor = grant.color ?? 'var(--accent-primary)';

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
        className="group frosted-card flex items-stretch rounded-xl overflow-hidden transition-all duration-150"
        style={{
          border: '1px solid var(--rule-subtle)',
          borderLeft: `4px solid ${accentColor}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.10)')}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)')}
      >
        {/* Main content */}
        <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0 px-5 py-4">
          {/* Top row: priority + chips */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
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
          <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--ink-primary)' }}>
            {grant.title}
          </h3>

          {/* Meta row */}
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            {meta.length > 0 && (
              <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                {meta.join('  ·  ')}
              </p>
            )}
            {amountLabel && (
              <span className="text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>
                {amountLabel}
              </span>
            )}
          </div>

          {/* Bottom row: deadline + tasks + themes */}
          <div className="mt-2.5 flex items-center gap-4 flex-wrap">
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
          <CardMenu triggerRadius="var(--radius-sm)">
            {close => (
              <>
                {grant.call_url && (
                  <MenuLink href={grant.call_url} onClick={close}>View call ↗</MenuLink>
                )}
                {onEdit && (
                  <MenuItem onClick={() => { close(); onEdit(grant); }}>Edit details</MenuItem>
                )}
                <MenuItem onClick={() => { close(); setTransition('submit'); }}>Mark as Submitted</MenuItem>
                <MenuItem onClick={() => { close(); onDelete(grant.id); }}>Delete</MenuItem>
              </>
            )}
          </CardMenu>

          <Link
            href={`/grants/${grant.id}?tab=editor`}
            className="text-xs font-semibold px-3 py-1.5 transition-all"
            style={{
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-primary)',
              color: '#fff',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#152d5a'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-primary)'; }}
          >
            Write →
          </Link>
        </div>
      </div>
    </>
  );
}
