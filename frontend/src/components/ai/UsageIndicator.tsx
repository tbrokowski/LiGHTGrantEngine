'use client';
import { useAuth } from '@/lib/auth';

export default function UsageIndicator() {
  const { user } = useAuth();

  if (!user) return null;

  const { ai_usage_cents: used, ai_usage_limit_cents: limit } = user;
  if (!limit) return null;

  const pct = Math.min(100, Math.round((used / limit) * 100));
  const usedDollars = (used / 100).toFixed(2);
  const limitDollars = (limit / 100).toFixed(2);

  const barColor =
    pct >= 100 ? 'bg-red-500' :
    pct >= 80 ? 'bg-amber-500' :
    'bg-gray-400';

  const textColor =
    pct >= 100 ? 'text-red-600' :
    pct >= 80 ? 'text-amber-600' :
    'text-gray-400';

  return (
    <div className={`flex items-center gap-1.5 text-xs ${textColor}`} title={`AI usage: $${usedDollars} of $${limitDollars}`}>
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums whitespace-nowrap">
        ${usedDollars} <span className="opacity-50">/ ${limitDollars}</span>
      </span>
    </div>
  );
}
