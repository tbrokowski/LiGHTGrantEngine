'use client';
import { useState } from 'react';
import BookmarkButton from './BookmarkButton';
import type { Opportunity } from './types';

export interface OpportunityActionHandlers {
  onToggleBookmark?: (id: string, isBookmarked: boolean) => void | Promise<void>;
  onStartGrant?: (id: string) => void | Promise<void>;
  onToggleRead?: (id: string, isRead: boolean) => void | Promise<void>;
  onPromoteToOrg?: (id: string, isOnOrg: boolean) => void | Promise<void>;
}

interface OpportunityActionsProps extends OpportunityActionHandlers {
  opp: Opportunity;
  mode?: 'queue' | 'shortlist' | 'org-shortlist' | 'awarded' | 'compact' | 'focus';
  className?: string;
}

export default function OpportunityActions({
  opp,
  mode = 'queue',
  className = '',
  onToggleBookmark,
  onStartGrant,
  onToggleRead,
  onPromoteToOrg,
}: OpportunityActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  // In personal shortlist mode all items are by definition bookmarked.
  // In queue/focus mode use the is_personal_shortlisted flag (with status fallback).
  const isBookmarked =
    mode === 'shortlist'
      ? true
      : (opp.is_personal_shortlisted ?? opp.status === 'potential_fit');

  const isOnOrg = !!opp.is_on_org_shortlist;

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
  const isTable = mode === 'queue' || mode === 'shortlist' || mode === 'org-shortlist';

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

  const startGrantBtn = onStartGrant ? (
    <button
      onClick={e => { e.stopPropagation(); run('grant', () => onStartGrant(opp.id)); }}
      disabled={!!busy}
      title="Start grant workspace"
      className={`${btnBase} text-white bg-blue-600 border-blue-600 hover:bg-blue-700 font-medium`}
    >
      {busy === 'grant' ? '…' : mode === 'focus' ? 'Start Grant' : '+ Grant'}
    </button>
  ) : null;

  // Promote-to-org button shown in personal shortlist mode
  const promoteBtn = onPromoteToOrg && mode === 'shortlist' ? (
    <button
      onClick={e => { e.stopPropagation(); run('promote', () => onPromoteToOrg(opp.id, isOnOrg)); }}
      disabled={!!busy}
      title={isOnOrg ? 'Remove from org shortlist' : 'Add to org shortlist'}
      className={`${btnBase} flex items-center gap-1 ${
        isOnOrg
          ? 'text-purple-700 border-purple-300 bg-purple-50 hover:bg-purple-100'
          : 'text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
      }`}
    >
      {busy === 'promote' ? (
        <span className="w-2 h-2 rounded-full bg-current animate-pulse inline-block" />
      ) : (
        <>
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="2" y="8" width="12" height="6" rx="1" />
            <path d="M8 2v6M5 5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isOnOrg ? 'In Org' : 'Share'}
        </>
      )}
    </button>
  ) : null;

  // Remove-from-org button shown in org-shortlist mode
  const removeFromOrgBtn = onPromoteToOrg && mode === 'org-shortlist' ? (
    <button
      onClick={e => { e.stopPropagation(); run('promote', () => onPromoteToOrg(opp.id, true)); }}
      disabled={!!busy}
      title="Remove from org shortlist"
      className={`${btnBase} text-purple-700 border-purple-200 bg-purple-50 hover:bg-red-50 hover:text-red-600 hover:border-red-200`}
    >
      {busy === 'promote' ? '…' : 'Remove'}
    </button>
  ) : null;

  return (
    <div className={`flex items-center gap-1.5 ${isTable ? 'w-full' : 'flex-wrap'} ${className}`}>
      {mode === 'queue' && (
        <div className="ml-auto flex items-center shrink-0">
          {readToggle}
        </div>
      )}

      {mode === 'shortlist' && (
        <>
          {viewLink}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {promoteBtn}
            {startGrantBtn}
            {bookmark}
          </div>
        </>
      )}

      {mode === 'org-shortlist' && (
        <>
          {viewLink}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {removeFromOrgBtn}
            {startGrantBtn}
          </div>
        </>
      )}

      {mode === 'awarded' && (
        <>
          {viewLink}
          <div className="ml-auto flex items-center shrink-0">
            {readToggle}
          </div>
        </>
      )}

      {(mode === 'focus' || mode === 'compact') && (
        <>
          {bookmark}
          {readToggle}
          {viewLink}
          {mode === 'focus' && startGrantBtn}
        </>
      )}
    </div>
  );
}
