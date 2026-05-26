'use client';
import { useState } from 'react';
import BookmarkButton from './BookmarkButton';
import type { Opportunity } from './types';

export interface OpportunityActionHandlers {
  onToggleBookmark?: (id: string, isBookmarked: boolean) => void | Promise<void>;
  onStartGrant?: (id: string) => void | Promise<void>;
}

interface OpportunityActionsProps extends OpportunityActionHandlers {
  opp: Opportunity;
  mode?: 'queue' | 'shortlist' | 'compact' | 'focus';
  className?: string;
}

export default function OpportunityActions({
  opp,
  mode = 'queue',
  className = '',
  onToggleBookmark,
  onStartGrant,
}: OpportunityActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const isBookmarked = opp.status === 'potential_fit';

  async function run(action: string, fn?: () => void | Promise<void>) {
    if (!fn || busy) return;
    setBusy(action);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const btnBase = mode === 'focus'
    ? 'px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40'
    : 'text-xs px-2 py-1 rounded-md border transition-colors disabled:opacity-40';

  const callDomain = opp.opportunity_url
    ? (() => { try { return new URL(opp.opportunity_url!).hostname.replace(/^www\./, ''); } catch { return null; } })()
    : null;

  const isTable = mode === 'queue' || mode === 'shortlist';
  const bookmark = onToggleBookmark ? (
    <BookmarkButton
      isBookmarked={isBookmarked}
      onToggle={() => run('bookmark', () => onToggleBookmark(opp.id, isBookmarked))}
      busy={busy === 'bookmark'}
      size={mode === 'focus' ? 'md' : 'sm'}
    />
  ) : null;

  const viewLink = opp.opportunity_url && mode !== 'compact' ? (
    <a
      href={opp.opportunity_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={callDomain ? `Open ${callDomain}` : 'View call'}
      className={`${btnBase} text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700`}
    >
      View ↗
    </a>
  ) : null;

  return (
    <div className={`flex items-center gap-1.5 ${isTable ? 'w-full' : 'flex-wrap'} ${className}`}>
      {isTable ? (
        <>
          {viewLink}
          {bookmark && <div className="ml-auto shrink-0">{bookmark}</div>}
        </>
      ) : (
        <>
          {bookmark}
          {viewLink}
          {onStartGrant && mode === 'focus' && (
            <button
              onClick={e => { e.stopPropagation(); run('grant', () => onStartGrant(opp.id)); }}
              disabled={!!busy}
              className={`${btnBase} text-white bg-blue-600 border-blue-600 hover:bg-blue-700 font-medium`}
            >
              {busy === 'grant' ? '…' : 'Start Grant'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
