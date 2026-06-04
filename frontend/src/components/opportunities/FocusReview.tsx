'use client';
import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import OpportunityCard from './OpportunityCard';
import OpportunityActions, { type OpportunityActionHandlers } from './OpportunityActions';
import type { Opportunity } from './types';

interface FocusReviewProps extends OpportunityActionHandlers {
  items: Opportunity[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onMarkRead?: (id: string) => void | Promise<void>;
}

export default function FocusReview({
  items,
  currentIndex,
  onIndexChange,
  onMarkRead,
  onToggleBookmark,
  onStartGrant,
}: FocusReviewProps) {
  const router = useRouter();
  const opp = items[currentIndex];
  const unreadCount = items.filter(o => !o.is_read).length;
  const prevIndexRef = useRef(currentIndex);
  const didResetRef = useRef(false);
  const markReadOnUnmountRef = useRef<{ items: Opportunity[]; onMarkRead?: (id: string) => void | Promise<void> }>({ items, onMarkRead });

  const goNext = useCallback(() => {
    if (currentIndex < items.length - 1) onIndexChange(currentIndex + 1);
  }, [currentIndex, items.length, onIndexChange]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onIndexChange(currentIndex - 1);
  }, [currentIndex, onIndexChange]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev]);

  useEffect(() => {
    const prev = prevIndexRef.current;
    if (prev !== currentIndex && items[prev] && !items[prev].is_read) {
      onMarkRead?.(items[prev].id);
    }
    prevIndexRef.current = currentIndex;
  }, [currentIndex, items, onMarkRead]);

  // Keep the unmount-ref current without triggering re-renders
  useEffect(() => {
    markReadOnUnmountRef.current = { items, onMarkRead };
  }, [items, onMarkRead]);

  useEffect(() => {
    return () => {
      const idx = prevIndexRef.current;
      const { items: latestItems, onMarkRead: latestMarkRead } = markReadOnUnmountRef.current;
      if (latestItems[idx] && !latestItems[idx].is_read) {
        latestMarkRead?.(latestItems[idx].id);
      }
    };
  }, []); // intentionally empty — runs only on unmount

  // Reset to first card if index goes out of bounds (must be in an effect, not render)
  useEffect(() => {
    if (!opp && items.length > 0 && !didResetRef.current) {
      didResetRef.current = true;
      onIndexChange(0);
    } else if (opp) {
      didResetRef.current = false;
    }
  }, [opp, items.length, onIndexChange]);

  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-16 text-center text-sm text-gray-400">
        No opportunities to review.
      </div>
    );
  }

  if (!opp) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4 text-sm text-gray-400">
        <span>
          {currentIndex + 1} of {items.length}
          {unreadCount > 0 && <span className="ml-2 text-blue-500">{unreadCount} unread</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition-colors"
            aria-label="Previous"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goNext}
            disabled={currentIndex >= items.length - 1}
            className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition-colors"
            aria-label="Next"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <OpportunityCard
        opp={opp}
        selected
        variant="focus"
        onClick={() => router.push(`/opportunities/${opp.id}`)}
      />

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <OpportunityActions
          opp={opp}
          mode="focus"
          onToggleBookmark={onToggleBookmark}
          onStartGrant={onStartGrant}
        />
      </div>

      <p className="text-center text-xs text-gray-300 mt-4">
        Use ← → arrow keys to navigate · Click card for full detail
      </p>
    </div>
  );
}
