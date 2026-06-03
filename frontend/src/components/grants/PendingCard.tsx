'use client';
import { useState } from 'react';
import Link from 'next/link';
import StageTransitionModal from './StageTransitionModal';
import { GrantSummary } from './ProposalCard';

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
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

export default function PendingCard({ grant, onStageChange, onDelete }: Props) {
  const [transition, setTransition] = useState<'accept' | 'reject' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const submittedDate = formatDate(grant.submitted_at);
  const amountLabel = formatAmount(grant.requested_amount, grant.currency);
  const accentColor = grant.color ?? 'var(--ink-faint)';

  return (
    <>
      {transition && (
        <StageTransitionModal
          grantId={grant.id}
          grantTitle={grant.title}
          transitionType={transition}
          requestedAmount={transition === 'accept' ? grant.requested_amount : undefined}
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
        {/* Left accent bar — muted for pending state */}
        <div
          className="w-1 shrink-0 self-stretch"
          style={{ background: accentColor, minHeight: '56px' }}
        />

        {/* Main content */}
        <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0 px-5 py-4">
          {/* Top row */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)', border: '1px solid var(--rule-subtle)' }}
            >
              Pending Decision
            </span>
            {grant.is_personal && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}
              >
                Personal
              </span>
            )}
            {amountLabel && (
              <span className="mono-data text-[11px] font-medium" style={{ color: 'var(--accent-warm)' }}>
                {amountLabel}
              </span>
            )}
          </div>

          {/* Title */}
          <h3
            className="text-sm font-medium leading-snug"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {grant.title}
          </h3>

          {/* Meta */}
          {grant.funder && (
            <p className="mono-data text-[11px] mt-1 truncate" style={{ color: 'var(--ink-muted)' }}>
              {grant.funder}
            </p>
          )}

          {/* Submitted date */}
          {submittedDate && (
            <p className="mono-data text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
              Submitted {submittedDate}
            </p>
          )}
        </Link>

        {/* Right: actions */}
        <div className="flex flex-col items-end justify-start px-4 py-4 shrink-0">
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
                  onClick={() => { setMenuOpen(false); setTransition('accept'); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--state-success)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-success-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Mark Accepted
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setTransition('reject'); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--state-danger)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-danger-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Mark Rejected
                </button>
                <div style={{ borderTop: '1px solid var(--rule-subtle)', margin: '4px 0' }} />
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onDelete(grant.id); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--state-danger)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-danger-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
