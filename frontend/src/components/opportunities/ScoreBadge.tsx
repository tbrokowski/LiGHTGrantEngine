const TIER_STYLES: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  medium: 'bg-amber-50 text-amber-700 border border-amber-100',
  low: 'bg-gray-100 text-gray-500 border border-gray-200',
  // legacy four-tier fallbacks
  high_priority: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  worth_reviewing: 'bg-amber-50 text-amber-700 border border-amber-100',
  watchlist: 'bg-sky-50 text-sky-700 border border-sky-100',
  low_fit: 'bg-gray-100 text-gray-500 border border-gray-200',
};

const TIER_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  high_priority: 'High',
  worth_reviewing: 'Medium',
  watchlist: 'Low',
  low_fit: 'Low',
};

export default function ScoreBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-gray-300">—</span>;
  const style = TIER_STYLES[priority] ?? 'bg-gray-100 text-gray-500 border border-gray-200';
  const label = TIER_LABELS[priority] ?? priority.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center justify-center px-2 h-6 rounded text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}
