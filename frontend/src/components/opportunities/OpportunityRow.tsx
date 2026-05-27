'use client';
import Link from 'next/link';
import ScoreBadge from './ScoreBadge';
import FunderLogo from './FunderLogo';
import OpportunityActions, { type OpportunityActionHandlers } from './OpportunityActions';
import { formatDate, formatAward, type Opportunity } from './types';

interface OpportunityRowProps extends OpportunityActionHandlers {
  opp: Opportunity;
  index: number;
  mode?: 'queue' | 'shortlist';
}

export default function OpportunityRow({
  opp,
  index,
  mode = 'queue',
  ...handlers
}: OpportunityRowProps) {
  const unread = !opp.is_read;

  return (
    <tr className={`group transition-colors border-b border-gray-100 ${
      index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
    } hover:bg-blue-50/30 ${unread ? '' : 'opacity-75'}`}>
      <td className="px-5 py-3.5">
        <Link href={`/opportunities/${opp.id}`} className="block">
          <div className="flex items-start gap-2">
            {unread && (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" title="Unread" />
            )}
            <div className="min-w-0">
              <span className={`text-sm truncate block max-w-xs leading-snug ${
                unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'
              } hover:text-gray-600`}>
                {opp.title}
              </span>
              {opp.short_summary ? (
                <span className="text-xs text-gray-400 mt-0.5 line-clamp-1 block max-w-sm">
                  {opp.short_summary}
                </span>
              ) : opp.thematic_areas?.length > 0 ? (
                <span className="text-xs text-gray-400 mt-0.5 truncate block max-w-xs">
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
        <div className="flex items-center gap-1.5 max-w-[160px]">
          <FunderLogo url={opp.funder_logo_url} name={opp.funder} />
          <span className="text-sm text-gray-500 truncate">{opp.funder ?? '—'}</span>
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
