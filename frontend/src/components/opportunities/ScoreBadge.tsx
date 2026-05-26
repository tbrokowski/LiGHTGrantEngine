export default function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-300">—</span>;
  const s = Math.round(score);
  const color = s >= 75 ? 'bg-emerald-50 text-emerald-700' : s >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center justify-center w-9 h-6 rounded text-xs font-semibold ${color}`}>
      {s}
    </span>
  );
}
