'use client';

const TAG_COLORS: Record<string, string> = {
  PI: 'bg-purple-100 text-purple-800',
  'co-I': 'bg-indigo-100 text-indigo-800',
  industry: 'bg-orange-100 text-orange-800',
  government: 'bg-blue-100 text-blue-800',
  ngo: 'bg-green-100 text-green-800',
  academia: 'bg-teal-100 text-teal-800',
  funder: 'bg-yellow-100 text-yellow-800',
  advisor: 'bg-pink-100 text-pink-800',
  reviewer: 'bg-gray-100 text-gray-700',
};

const DEFAULT_COLOR = 'bg-slate-100 text-slate-700';

interface PartnerTagChipProps {
  tag: string;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

export default function PartnerTagChip({ tag, onRemove, size = 'sm' }: PartnerTagChipProps) {
  const color = TAG_COLORS[tag.toLowerCase()] ?? DEFAULT_COLOR;
  const sizeClass = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${color} ${sizeClass}`}>
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 hover:opacity-70 leading-none"
          aria-label={`Remove ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
