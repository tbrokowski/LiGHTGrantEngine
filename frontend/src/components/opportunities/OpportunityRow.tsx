'use client';
import Link from 'next/link';
import ScoreBadge from './ScoreBadge';
import FunderLogo from './FunderLogo';
import OpportunityActions, { type OpportunityActionHandlers } from './OpportunityActions';
import OpportunityTypeBadge from './OpportunityTypeBadge';
import { formatDate, formatAward, type Opportunity } from './types';

interface OpportunityRowProps extends OpportunityActionHandlers {
  opp: Opportunity;
  index: number;
  mode?: 'queue' | 'shortlist' | 'org-shortlist';
  onNavigate?: (id: string) => void;
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

  return (
    <tr
      style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      className="group transition-colors"
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td className="px-5 py-3">
        <Link href={`/opportunities/${opp.id}`} className="block" onClick={() => onNavigate?.(opp.id)}>
          <div className="flex items-start gap-2">
            {unread && (
              <span
                className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: 'var(--accent-primary)' }}
                title="Unread"
              />
            )}
            <div className="min-w-0">
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
            </div>
          </div>
        </Link>
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
      <td className="px-4 py-3 text-center">
        <ScoreBadge priority={opp.priority} fitScore={opp.fit_score} />
      </td>
      <td className="px-3 py-3">
        <OpportunityActions opp={opp} mode={mode} {...handlers} />
      </td>
    </tr>
  );
}
