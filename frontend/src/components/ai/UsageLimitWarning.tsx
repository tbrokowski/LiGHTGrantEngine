'use client';
import { useAuth } from '@/lib/auth';

export default function UsageLimitWarning() {
  const { user } = useAuth();

  if (!user) return null;

  const { ai_usage_cents: used, ai_usage_limit_cents: limit } = user;
  if (!limit) return null;

  const pct = Math.round((used / limit) * 100);

  if (pct < 80) return null;

  const usedDollars = (used / 100).toFixed(2);
  const limitDollars = (limit / 100).toFixed(2);
  const isBlocked = pct >= 100;

  if (isBlocked) {
    return (
      <div className="mx-4 my-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-red-800">AI usage limit reached</p>
          <p className="text-xs text-red-600 mt-0.5">
            You have used ${usedDollars} of your ${limitDollars} limit. AI features are temporarily unavailable.
            Contact support to increase your limit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-amber-800">
          AI usage is at {pct}% (${usedDollars} of ${limitDollars})
        </p>
      </div>
    </div>
  );
}
