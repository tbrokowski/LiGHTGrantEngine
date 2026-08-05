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
  high: 'High Fit',
  medium: 'Medium Fit',
  low: 'Low Fit',
  high_priority: 'High Fit',
  worth_reviewing: 'Medium Fit',
  watchlist: 'Low Fit',
  low_fit: 'Low Fit',
};

function tierFromScore(score: number): string {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

export default function ScoreBadge({
  priority,
  fitScore,
  personalFit,
}: {
  priority: string | null;
  fitScore?: number | null;
  /** Personalized "relevance to you" score (0–100). When present it drives both
   *  the number shown AND the tier, so the badge matches the feed's sort order. */
  personalFit?: number | null;
}) {
  // Prefer the personalized score so the number equals the sort key.
  const score = personalFit != null ? personalFit : fitScore;
  const tier = personalFit != null ? tierFromScore(personalFit) : priority;
  if (!tier) return <span className="text-gray-300">—</span>;
  const style = TIER_STYLES[tier] ?? 'bg-gray-100 text-gray-500 border border-gray-200';
  const label = TIER_LABELS[tier] ?? tier.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center justify-center px-2 h-6 rounded text-xs font-semibold ${style}`}>
      {label}{score != null ? ` · ${Math.round(score)}` : ''}
    </span>
  );
}
