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

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatAmount(amount: number | null, currency: string | null) {
  if (!amount) return null;
  const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return `${currency ?? '$'}${fmt.format(amount)}`;
}

interface Props {
  grant: GrantSummary;
  onStageChange: (id: string, newStage: string) => void;
  onDelete: (id: string) => void;
}

export default function PendingCard({ grant, onStageChange, onDelete }: Props) {
  const [transition, setTransition] = useState<'accept' | 'reject' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const submittedDate = formatDate(grant.submitted_at);
  const amountLabel = formatAmount(grant.requested_amount, grant.currency);
  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);

  return (
    <>
      {transition && (
        <StageTransitionModal
          grantId={grant.id}
          grantTitle={grant.title}
          transitionType={transition}
          requestedAmount={transition === 'accept' ? grant.requested_amount : undefined}
          onClose={() => setTransition(null)}
          onSuccess={(stage) => { setTransition(null); onStageChange(grant.id, stage); }}
        />
      )}
      <div
        className="group border border-gray-200 bg-gray-50/60 rounded-2xl px-5 py-4 hover:shadow-sm hover:-translate-y-px transition-all duration-150"
        style={grant.color ? { borderLeftColor: grant.color, borderLeftWidth: '4px' } : undefined}
      >
        <div className="flex items-start gap-3">
          <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">
                Pending Decision
              </span>
              {grant.is_personal && (
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Personal</span>
              )}
              {amountLabel && (
                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {amountLabel}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-700 leading-snug">
              {grant.title}
            </h3>
            {meta.length > 0 && (
              <p className="text-xs text-gray-400 mt-1 truncate">{meta.join(' · ')}</p>
            )}
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {submittedDate && (
                <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                  Submitted {submittedDate}
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
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-10"
                  onMouseLeave={() => setMenuOpen(false)}>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setTransition('accept'); }}
                    className="w-full text-left px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50"
                  >
                    Mark Accepted
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setTransition('reject'); }}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Mark Rejected
                  </button>
                  <div className="my-1 border-t border-gray-100" />
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
