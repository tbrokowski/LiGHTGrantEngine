'use client';
import { useState } from 'react';
import Link from 'next/link';
import StageTransitionModal from './StageTransitionModal';
import CardMenu, { MenuDivider, MenuItem, MenuLink } from './CardMenu';
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
  onEdit?: (grant: GrantSummary) => void;
}

export default function PendingCard({ grant, onStageChange, onDelete, onEdit }: Props) {
  const [transition, setTransition] = useState<'accept' | 'reject' | null>(null);

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
          {/* Top row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
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
              <span className="text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>
                {amountLabel}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--ink-primary)' }}>
            {grant.title}
          </h3>

          {/* Meta */}
          {grant.funder && (
            <p className="text-xs mt-1.5 truncate" style={{ color: 'var(--ink-muted)' }}>
              {grant.funder}
            </p>
          )}

          {/* Submitted date */}
          {submittedDate && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--ink-faint)' }}>
              Submitted {submittedDate}
            </p>
          )}
        </Link>

        {/* Right: actions */}
        <div className="flex flex-col items-end justify-start px-4 py-4 shrink-0">
          <CardMenu>
            {close => (
              <>
                {grant.call_url && (
                  <MenuLink href={grant.call_url} onClick={close}>View call ↗</MenuLink>
                )}
                <MenuItem onClick={() => { close(); setTransition('accept'); }}>Mark Accepted</MenuItem>
                <MenuItem onClick={() => { close(); setTransition('reject'); }}>Mark Rejected</MenuItem>
                {onEdit && (
                  <MenuItem onClick={() => { close(); onEdit(grant); }}>Edit details</MenuItem>
                )}
                <MenuDivider />
                <MenuItem onClick={() => { close(); onDelete(grant.id); }}>Delete</MenuItem>
              </>
            )}
          </CardMenu>
        </div>
      </div>
    </>
  );
}
