'use client';
import { useState } from 'react';
import BookmarkButton from './BookmarkButton';
import type { Opportunity } from './types';

export interface OpportunityActionHandlers {
  onToggleBookmark?: (id: string, isBookmarked: boolean) => void | Promise<void>;
  onStartGrant?: (id: string) => void | Promise<void>;
  onToggleRead?: (id: string, isRead: boolean) => void | Promise<void>;
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
  onToggleRead,
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

  const isRead = !!opp.is_read;
  const isTable = mode === 'queue' || mode === 'shortlist';

  const readToggle = onToggleRead ? (
    <button
      onClick={e => { e.stopPropagation(); run('read', () => onToggleRead(opp.id, isRead)); }}
      disabled={!!busy}
      title={isRead ? 'Mark as unread' : 'Mark as read'}
      className={`${btnBase} flex items-center gap-1 disabled:opacity-40 transition-colors ${
        isRead
          ? 'text-gray-400 border-gray-200 hover:text-blue-600 hover:border-blue-300'
          : 'text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100'
      }`}
    >
      {busy === 'read' ? (
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
  ) : null;

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
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {readToggle}
            {bookmark}
          </div>
        </>
      ) : (
        <>
          {bookmark}
          {readToggle}
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
