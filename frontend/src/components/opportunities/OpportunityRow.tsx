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
}

export default function OpportunityRow({
  opp,
  index,
  mode = 'queue',
  ...handlers
}: OpportunityRowProps) {
  const unread = !opp.is_read;
  const shortlisted = opp.is_personal_shortlisted || opp.is_on_org_shortlist;
  const prominent = unread || shortlisted;

  return (
    <tr className={`group transition-colors border-b border-gray-100 ${
      index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
    } hover:bg-blue-50/30 ${prominent ? '' : 'opacity-75'}`}>
      <td className="px-5 py-3.5">
        <Link href={`/opportunities/${opp.id}`} className="block">
          <div className="flex items-start gap-2">
            {unread && (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" title="Unread" />
            )}
            <div className="min-w-0">
              <span className={`text-sm block leading-snug ${
                prominent ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'
              } hover:text-gray-600`}>
                {opp.title}
              </span>
              {opp.short_summary ? (
                <span className="text-xs text-gray-400 mt-0.5 line-clamp-2 block">
                  {opp.short_summary}
                </span>
              ) : opp.thematic_areas?.length > 0 ? (
                <span className="text-xs text-gray-400 mt-0.5 block">
                  {opp.thematic_areas.slice(0, 3).join(' · ')}
                </span>
              ) : !opp.has_description ? (
                <span className="text-xs text-gray-300 mt-0.5 italic block">Fetching description…</span>
              ) : null}
            </div>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3.5 hidden md:table-cell">
        <div className="flex flex-col gap-1 max-w-[160px]">
          <div className="flex items-center gap-1.5">
            <FunderLogo url={opp.funder_logo_url} name={opp.funder} />
            <span className="text-sm text-gray-500 truncate">{opp.funder ?? '—'}</span>
          </div>
          {opp.opportunity_type && <OpportunityTypeBadge type={opp.opportunity_type} size="xs" />}
        </div>
      </td>
      <td className="px-4 py-3.5 text-sm text-gray-500 hidden lg:table-cell whitespace-nowrap">
        {formatDate(opp.deadline) ?? '—'}
      </td>
      <td className="px-4 py-3.5 text-sm text-gray-500 text-right hidden lg:table-cell whitespace-nowrap">
        {formatAward(opp.award_min, opp.award_max, opp.currency) ?? '—'}
      </td>
      <td className="px-4 py-3.5 text-center">
        <ScoreBadge priority={opp.priority} fitScore={opp.fit_score} />
      </td>
      <td className="px-3 py-3.5">
        <OpportunityActions
          opp={opp}
          mode={mode}
          {...handlers}
        />
      </td>
    </tr>
  );
}
