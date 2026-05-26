'use client';
import Link from 'next/link';
import { GrantSummary } from './ProposalCard';

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function formatCurrency(amount: number | null, currency: string | null) {
  if (!amount) return null;
  const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return `${currency ?? '$'}${fmt.format(amount)}`;
}

function TaskProgress({ tasks }: { tasks?: { status: string }[] }) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === 'completed').length;
  const pct = Math.round((done / tasks.length) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 bg-emerald-100 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">{pct}%</span>
    </div>
  );
}

interface Props {
  grant: GrantSummary;
}

export default function ActiveGrantCard({ grant }: Props) {
  const awardedDate = formatDate(grant.decision_at);
  const awardAmt = formatCurrency(grant.award_amount, grant.currency);

  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);

  return (
    <Link href={`/grants/${grant.id}`}>
      <div className="group border border-emerald-100 bg-emerald-50/30 rounded-2xl px-5 py-4 hover:shadow-md hover:-translate-y-px transition-all duration-150 cursor-pointer">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                Active
              </span>
              {awardAmt && (
                <span className="text-xs text-emerald-600 font-medium">{awardAmt}</span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900 leading-snug group-hover:text-emerald-800 transition-colors">
              {grant.title}
            </h3>
            {meta.length > 0 && (
              <p className="text-xs text-gray-400 mt-1 truncate">{meta.join(' · ')}</p>
            )}
            <div className="mt-2.5 flex items-center gap-3 flex-wrap">
              <TaskProgress tasks={grant.tasks} />
              {awardedDate && (
                <span className="text-xs text-gray-400">Awarded {awardedDate}</span>
              )}
            </div>
          </div>
          <div className="text-gray-200 group-hover:text-gray-400 transition-colors mt-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}
