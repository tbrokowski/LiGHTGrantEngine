'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ScoreBadge from './ScoreBadge';
import FunderLogo from './FunderLogo';
import { formatDate, formatAward, PRIORITY_COLORS, PRIORITY_LABELS, type Opportunity } from './types';

const MarkdownContent = dynamic(() => import('./MarkdownContent'), {
  loading: () => <p className="text-sm text-gray-400">Loading…</p>,
  ssr: false,
});

interface OpportunityCardProps {
  opp: Opportunity;
  onClick?: () => void;
  selected?: boolean;
  variant?: 'default' | 'focus';
}

export default function OpportunityCard({ opp, onClick, selected, variant = 'default' }: OpportunityCardProps) {
  const unread = !opp.is_read;

  const content = (
    <div className={`bg-white border rounded-2xl shadow-sm transition-all duration-150 px-6 py-5 ${
      selected ? 'border-blue-400 ring-2 ring-blue-100 shadow-md' : 'border-gray-100 hover:shadow-md hover:-translate-y-px'
    }`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FunderLogo url={opp.funder_logo_url} name={opp.funder} size="md" />
          <div className="min-w-0">
            {opp.funder && <p className="text-xs text-gray-400 truncate">{opp.funder}</p>}
            <div className="flex items-center gap-2">
              {unread && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
              <h2 className={`text-base leading-snug truncate ${
                unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'
              }`}>
                {opp.title}
              </h2>
            </div>
          </div>
        </div>
        <ScoreBadge priority={opp.priority} fitScore={opp.fit_score} />
      </div>

      {variant === 'focus' ? (
        opp.description ? (
          <div className="text-sm text-gray-600 leading-relaxed mb-4 max-h-72 overflow-y-auto prose prose-sm prose-gray max-w-none [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2">
            <MarkdownContent>{opp.description}</MarkdownContent>
          </div>
        ) : opp.short_summary ? (
          <p className="text-sm text-gray-500 leading-relaxed mb-4">{opp.short_summary}</p>
        ) : !opp.has_description ? (
          <p className="text-sm text-gray-300 italic mb-4">Fetching description…</p>
        ) : null
      ) : opp.short_summary ? (
        <p className="text-sm text-gray-500 leading-relaxed line-clamp-3 mb-4">
          {opp.short_summary}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mb-3">
        {formatDate(opp.deadline) && <span>Deadline: {formatDate(opp.deadline)}</span>}
        {formatAward(opp.award_min, opp.award_max, opp.currency) && (
          <>
            <span className="text-gray-200">·</span>
            <span>{formatAward(opp.award_min, opp.award_max, opp.currency)}</span>
          </>
        )}
        {opp.priority && (
          <>
            <span className="text-gray-200">·</span>
            <span className={`px-1.5 py-0.5 rounded ${PRIORITY_COLORS[opp.priority] ?? 'bg-gray-100 text-gray-500'}`}>
              {PRIORITY_LABELS[opp.priority] ?? opp.priority}
            </span>
          </>
        )}
      </div>

      {opp.thematic_areas?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {opp.thematic_areas.slice(0, 4).map(t => (
            <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full text-left">
        {content}
      </button>
    );
  }

  return (
    <Link href={`/opportunities/${opp.id}`} className="block">
      {content}
    </Link>
  );
}
