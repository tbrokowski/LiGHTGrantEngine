'use client';
import { useState } from 'react';
import Link from 'next/link';
import StageTransitionModal from './StageTransitionModal';
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
  onStageChange: (id: string, newStage: string) => void;
  onDelete: (id: string) => void;
}

export default function ActiveGrantCard({ grant, onStageChange, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const awardedDate = formatDate(grant.decision_at);
  const awardAmt = formatCurrency(grant.award_amount, grant.currency);

  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);

  return (
    <>
      {archiving && (
        <StageTransitionModal
          grantId={grant.id}
          grantTitle={grant.title}
          transitionType="archive"
          onClose={() => setArchiving(false)}
          onSuccess={(stage) => { setArchiving(false); onStageChange(grant.id, stage); }}
        />
      )}
      <div
        className="group border border-emerald-100 bg-emerald-50/30 rounded-2xl px-5 py-4 hover:shadow-md hover:-translate-y-px transition-all duration-150"
        style={grant.color ? { borderLeftColor: grant.color, borderLeftWidth: '4px' } : undefined}
      >
        <div className="flex items-start gap-3">
          <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0 cursor-pointer">
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
                <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                  Awarded {awardedDate}
                </span>
              )}
            </div>
          </Link>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-10"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setArchiving(true); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Move to Archive
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onDelete(grant.id); }}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
