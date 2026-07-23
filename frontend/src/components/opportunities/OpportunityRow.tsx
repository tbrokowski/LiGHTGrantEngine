'use client';
import { useState } from 'react';
import Link from 'next/link';
import FunderLogo from './FunderLogo';
import OpportunityActions, { type OpportunityActionHandlers } from './OpportunityActions';
import OpportunityTypeBadge from './OpportunityTypeBadge';
import { formatDate, formatAward, type Opportunity } from './types';

interface OpportunityRowProps extends OpportunityActionHandlers {
  opp: Opportunity;
  index: number;
  mode?: 'queue' | 'shortlist' | 'org-shortlist' | 'awarded';
  onNavigate?: (id: string) => void;
}

// Fit-tier left-border accent — replaces the visible "Score" badge with a
// subtle color cue so fit doesn't compete visually with the title/summary.
// Exported so the shortlist board can reuse the same tier→color mapping.
export const TIER_ACCENT: Record<string, string> = {
  high: 'var(--state-success)',
  high_priority: 'var(--state-success)',
  medium: 'var(--state-warning)',
  worth_reviewing: 'var(--state-warning)',
  low: 'var(--rule-strong)',
  low_fit: 'var(--rule-strong)',
  watchlist: 'var(--state-info)',
};

// Compact match-score pill shown to the left of the title.
const TIER_PILL: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'var(--state-success-bg)', fg: 'var(--state-success)' },
  high_priority: { bg: 'var(--state-success-bg)', fg: 'var(--state-success)' },
  medium: { bg: 'var(--state-warning-bg)', fg: 'var(--state-warning)' },
  worth_reviewing: { bg: 'var(--state-warning-bg)', fg: 'var(--state-warning)' },
  watchlist: { bg: 'var(--state-info-bg)', fg: 'var(--state-info)' },
  low: { bg: 'var(--surface-sunken)', fg: 'var(--ink-muted)' },
  low_fit: { bg: 'var(--surface-sunken)', fg: 'var(--ink-muted)' },
};

export function MatchScorePill({ priority, fitScore }: { priority: string | null; fitScore?: number | null }) {
  if (fitScore == null) return null;
  const pill = TIER_PILL[priority ?? ''] ?? { bg: 'var(--surface-sunken)', fg: 'var(--ink-muted)' };
  return (
    <span
      className="mono-data shrink-0 inline-flex items-center justify-center rounded text-[10px] font-semibold px-1.5 h-5"
      style={{ background: pill.bg, color: pill.fg }}
      title="Match score"
    >
      {Math.round(fitScore)}
    </span>
  );
}

// Standalone read/unread toggle (the blue button). Kept outside the title <Link>
// so we don't nest a <button> inside an <a>. Self-contained busy state.
export function ReadToggleButton({
  opp,
  onToggleRead,
}: {
  opp: Opportunity;
  onToggleRead?: (id: string, isRead: boolean) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!onToggleRead) return null;
  const isRead = !!opp.is_read;
  return (
    <button
      onClick={async e => {
        e.stopPropagation();
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try { await onToggleRead(opp.id, isRead); } finally { setBusy(false); }
      }}
      disabled={busy}
      title={isRead ? 'Mark as unread' : 'Mark as read'}
      className={`text-xs px-2 py-1 rounded-md border flex items-center gap-1 transition-colors disabled:opacity-40 ${
        isRead
          ? 'text-gray-400 border-gray-200 hover:text-blue-600 hover:border-blue-300'
          : 'text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100'
      }`}
    >
      {busy ? (
        <span className="w-2 h-2 rounded-full bg-current animate-pulse inline-block" />
      ) : isRead ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="8" cy="8" r="5" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="5" />
        </svg>
      )}
    </button>
  );
}

export default function OpportunityRow({
  opp,
  index,
  mode = 'queue',
  onNavigate,
  ...handlers
}: OpportunityRowProps) {
  const unread = !opp.is_read;
  const shortlisted = opp.is_personal_shortlisted || opp.is_on_org_shortlist;
  const prominent = unread || shortlisted;
  const tierAccent = TIER_ACCENT[opp.priority ?? ''] ?? 'transparent';
  // Read toggle moves to the left; everything else (view link, etc.) stays right.
  const { onToggleRead, ...restHandlers } = handlers;

  return (
    <tr
      style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      className="group transition-colors"
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td className="py-3 pr-5" style={{ borderLeft: `3px solid ${tierAccent}`, paddingLeft: '17px' }}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            <ReadToggleButton opp={opp} onToggleRead={onToggleRead} />
          </span>
          <Link href={`/opportunities/${opp.id}`} className="block min-w-0 flex-1" onClick={() => onNavigate?.(opp.id)}>
            <span
              className="text-sm block leading-snug"
              style={{
                fontWeight: prominent ? 500 : 400,
                color: prominent ? 'var(--ink-primary)' : 'var(--ink-muted)',
              }}
            >
              {opp.title}
            </span>
            {(opp.short_summary || opp.description) ? (
              <span className="text-xs mt-0.5 line-clamp-2 block" style={{ color: 'var(--ink-muted)' }}>
                {opp.short_summary || opp.description}
              </span>
            ) : opp.thematic_areas?.length > 0 ? (
              <span className="mono-data text-[11px] mt-0.5 block" style={{ color: 'var(--ink-faint)' }}>
                {opp.thematic_areas.slice(0, 3).join('  ·  ')}
              </span>
            ) : !opp.has_description ? (
              <span className="text-xs mt-0.5 italic block" style={{ color: 'var(--ink-faint)' }}>
                Fetching description…
              </span>
            ) : null}
          </Link>
        </div>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <div className="flex flex-col gap-1 max-w-[160px]">
          <div className="flex items-center gap-1.5">
            <FunderLogo url={opp.funder_logo_url} name={opp.funder} />
            <span className="text-sm truncate" style={{ color: 'var(--ink-muted)' }}>
              {opp.funder ?? '—'}
            </span>
          </div>
          {opp.opportunity_type && <OpportunityTypeBadge type={opp.opportunity_type} size="xs" />}
        </div>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell whitespace-nowrap">
        <span className="mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {formatDate(opp.deadline) ?? '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-right hidden lg:table-cell whitespace-nowrap">
        <span className="mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {formatAward(opp.award_min, opp.award_max, opp.currency) ?? '—'}
        </span>
      </td>
      <td className="px-3 py-3 text-right w-16">
        <div className="flex items-center justify-end gap-2">
          <MatchScorePill priority={opp.priority} fitScore={opp.fit_score} />
          <OpportunityActions opp={opp} mode={mode} {...restHandlers} />
        </div>
      </td>
    </tr>
  );
}
