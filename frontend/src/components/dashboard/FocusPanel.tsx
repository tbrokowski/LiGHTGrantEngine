'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

export interface GrantItem {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  priority: string | null;
  grant_stage: string;
  external_deadline: string | null;
  internal_deadline: string | null;
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  try {
    const diff = new Date(d).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
}

const NEEDS_REVIEW_STATUSES = new Set([
  'internal_review',
  'pi_review',
  'go_no_go_pending',
  'institutional_approval',
]);

const STAGE_LABEL: Record<string, string> = {
  proposal: 'Proposal',
  pending: 'Pending',
  active: 'Active',
  rejected: 'Rejected',
  archived: 'Archived',
};

const STAGE_COLOR: Record<string, string> = {
  proposal: 'bg-blue-50 text-blue-600',
  pending: 'bg-amber-50 text-amber-600',
  active: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-500',
  archived: 'bg-gray-100 text-gray-400',
};

const LS_STARRED = 'dashboard_starred';
const LS_FLAGGED = 'dashboard_flagged';

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveSet(key: string, s: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch {}
}

interface FocusRowProps {
  grant: GrantItem;
  days: number | null;
  urgency: 'overdue' | 'week' | 'review' | 'starred' | 'normal';
  starred: boolean;
  flagged: boolean;
  onToggleStar: (id: string) => void;
  onToggleFlag: (id: string) => void;
}

function FocusRow({ grant, days, urgency, starred, flagged, onToggleStar, onToggleFlag }: FocusRowProps) {
  const urgencyDot =
    urgency === 'overdue' ? 'bg-red-400' :
    urgency === 'week' ? 'bg-amber-400' :
    urgency === 'review' ? 'bg-violet-400' :
    starred ? 'bg-indigo-400' : 'bg-gray-200';

  const dayLabel =
    days === null ? null :
    days < 0 ? `${Math.abs(days)}d overdue` :
    days === 0 ? 'Today' :
    `${days}d`;

  const dayColor =
    days !== null && days < 0 ? 'text-red-500' :
    days !== null && days <= 7 ? 'text-amber-600' :
    days !== null && days <= 30 ? 'text-amber-500' : 'text-gray-400';

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50/80 transition-colors group">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyDot}`} />
      <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate leading-snug">{grant.title}</p>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {[grant.funder, grant.external_deadline ? formatDate(grant.external_deadline) : null].filter(Boolean).join(' · ')}
        </p>
      </Link>
      <div className="shrink-0 flex items-center gap-1.5">
        {grant.grant_stage && (
          <span className={`hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${STAGE_COLOR[grant.grant_stage] ?? 'bg-gray-100 text-gray-500'}`}>
            {STAGE_LABEL[grant.grant_stage] ?? grant.grant_stage}
          </span>
        )}
        {dayLabel && (
          <span className={`text-[11px] font-semibold tabular-nums w-16 text-right ${dayColor}`}>
            {dayLabel}
          </span>
        )}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFlag(grant.id); }}
          className={`p-0.5 rounded transition-colors ${flagged ? 'text-red-400' : 'text-gray-200 hover:text-gray-400'}`}
          title="Flag"
        >
          <svg className="w-3.5 h-3.5" fill={flagged ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18M3 6l9-3 9 3v9l-9 3-9-3V6z" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleStar(grant.id); }}
          className={`p-0.5 rounded transition-colors ${starred ? 'text-indigo-400' : 'text-gray-200 hover:text-gray-400'}`}
          title="Star"
        >
          <svg className="w-3.5 h-3.5" fill={starred ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface SectionProps {
  label: string;
  labelColor: string;
  children: React.ReactNode;
}

function Section({ label, labelColor, children }: SectionProps) {
  return (
    <div>
      <p className={`px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest ${labelColor}`}>{label}</p>
      {children}
    </div>
  );
}

interface FocusPanelProps {
  grants: GrantItem[];
  loading: boolean;
}

export default function FocusPanel({ grants, loading }: FocusPanelProps) {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  useEffect(() => {
    setStarred(loadSet(LS_STARRED));
    setFlagged(loadSet(LS_FLAGGED));
  }, []);

  const toggleStar = useCallback((id: string) => {
    setStarred(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveSet(LS_STARRED, next);
      return next;
    });
  }, []);

  const toggleFlag = useCallback((id: string) => {
    setFlagged(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveSet(LS_FLAGGED, next);
      return next;
    });
  }, []);

  const overdue: GrantItem[] = [];
  const thisWeek: GrantItem[] = [];
  const needsReview: GrantItem[] = [];
  const starredItems: GrantItem[] = [];
  const seen = new Set<string>();

  // Priority order: overdue → this week → needs review → starred
  // A grant can appear in multiple groups, but we deduplicate by showing in highest-priority bucket
  for (const g of grants) {
    const days = daysUntil(g.external_deadline);
    if (days !== null && days < 0) { overdue.push(g); seen.add(g.id); continue; }
    if (days !== null && days <= 7) { thisWeek.push(g); seen.add(g.id); continue; }
  }
  for (const g of grants) {
    if (seen.has(g.id)) continue;
    if (NEEDS_REVIEW_STATUSES.has(g.status)) { needsReview.push(g); seen.add(g.id); }
  }
  for (const g of grants) {
    if (seen.has(g.id)) continue;
    if (starred.has(g.id)) { starredItems.push(g); seen.add(g.id); }
  }
  // Also add starred items that were already in other buckets to show star context
  const starredInOtherBuckets = grants.filter(g => starred.has(g.id) && seen.has(g.id) && !starredItems.includes(g));

  const isEmpty = overdue.length === 0 && thisWeek.length === 0 && needsReview.length === 0 && starredItems.length === 0;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3.5 border-b border-gray-50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Focus</h2>
        <p className="text-[10px] text-gray-400 font-medium">
          {[overdue.length > 0 && `${overdue.length} overdue`, thisWeek.length > 0 && `${thisWeek.length} due soon`].filter(Boolean).join(' · ') || 'All clear'}
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10">
          <div className="space-y-2 w-full px-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />
            ))}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 px-4 text-center">
          <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-500">Nothing urgent</p>
          <p className="text-xs text-gray-300 mt-1">Star grants above to track them here</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {overdue.length > 0 && (
            <Section label="Overdue" labelColor="text-red-500">
              {overdue.map(g => (
                <FocusRow key={g.id} grant={g} days={daysUntil(g.external_deadline)} urgency="overdue"
                  starred={starred.has(g.id)} flagged={flagged.has(g.id)}
                  onToggleStar={toggleStar} onToggleFlag={toggleFlag} />
              ))}
            </Section>
          )}
          {thisWeek.length > 0 && (
            <Section label="Due This Week" labelColor="text-amber-500">
              {thisWeek.map(g => (
                <FocusRow key={g.id} grant={g} days={daysUntil(g.external_deadline)} urgency="week"
                  starred={starred.has(g.id)} flagged={flagged.has(g.id)}
                  onToggleStar={toggleStar} onToggleFlag={toggleFlag} />
              ))}
            </Section>
          )}
          {needsReview.length > 0 && (
            <Section label="Needs Review" labelColor="text-violet-500">
              {needsReview.map(g => (
                <FocusRow key={g.id} grant={g} days={daysUntil(g.external_deadline)} urgency="review"
                  starred={starred.has(g.id)} flagged={flagged.has(g.id)}
                  onToggleStar={toggleStar} onToggleFlag={toggleFlag} />
              ))}
            </Section>
          )}
          {starredItems.length > 0 && (
            <Section label="Starred" labelColor="text-indigo-500">
              {starredItems.map(g => (
                <FocusRow key={g.id} grant={g} days={daysUntil(g.external_deadline)} urgency="starred"
                  starred={true} flagged={flagged.has(g.id)}
                  onToggleStar={toggleStar} onToggleFlag={toggleFlag} />
              ))}
            </Section>
          )}
          {/* Hint if there are starred items already categorized above */}
          {starredInOtherBuckets.length > 0 && starred.size > starredItems.length && (
            <p className="px-4 py-2 text-[10px] text-gray-300">
              {starred.size - starredItems.length} starred item{starred.size - starredItems.length > 1 ? 's' : ''} also in sections above
            </p>
          )}
        </div>
      )}
    </div>
  );
}
