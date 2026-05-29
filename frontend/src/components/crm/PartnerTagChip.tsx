'use client';

interface PartnerTagChipProps {
  tag: string;
  onRemove?: () => void;
  color?: 'blue' | 'indigo' | 'green' | 'amber' | 'purple' | 'gray';
}

const COLOR_CLASSES: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  green: 'bg-green-50 text-green-700 border-green-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function PartnerTagChip({ tag, onRemove, color = 'blue' }: PartnerTagChipProps) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${COLOR_CLASSES[color]}`}>
      {tag}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:opacity-70 ml-0.5">×</button>
      )}
    </span>
  );
}
