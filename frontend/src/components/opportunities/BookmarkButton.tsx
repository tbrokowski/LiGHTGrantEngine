'use client';
import { Bookmark } from 'lucide-react';

interface BookmarkButtonProps {
  isBookmarked: boolean;
  onToggle: () => void | Promise<void>;
  busy?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export default function BookmarkButton({
  isBookmarked,
  onToggle,
  busy = false,
  size = 'sm',
  className = '',
}: BookmarkButtonProps) {
  const iconSize = size === 'md' ? 'w-5 h-5' : 'w-4 h-4';
  const btnSize = size === 'md' ? 'w-9 h-9' : 'w-7 h-7';

  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        if (!busy) onToggle();
      }}
      disabled={busy}
      title={isBookmarked ? 'Remove from shortlist' : 'Add to shortlist'}
      aria-label={isBookmarked ? 'Remove from shortlist' : 'Add to shortlist'}
      aria-pressed={isBookmarked}
      className={`${btnSize} inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        isBookmarked
          ? 'text-blue-600 hover:bg-blue-50'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
      } ${className}`}
    >
      <Bookmark
        className={`${iconSize} ${isBookmarked ? 'fill-blue-600 text-blue-600' : ''}`}
      />
    </button>
  );
}
