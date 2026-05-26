'use client';
import { useState } from 'react';
import Link from 'next/link';
import PriorityTag from './PriorityTag';
import StageTransitionModal from './StageTransitionModal';

export interface GrantSummary {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  priority: string | null;
  grant_stage: string;
  external_deadline: string | null;
  internal_deadline: string | null;
  submitted_at: string | null;
  decision_at: string | null;
  pi_name: string | null;
  themes: string[];
  is_personal: boolean;
  program: string | null;
  requested_amount: number | null;
  currency: string | null;
  award_amount: number | null;
  tasks?: { status: string }[];
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function DeadlineChip({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-gray-300 text-xs">No deadline</span>;
  const days = daysUntil(dateStr);
  const label = formatDate(dateStr);
  if (days === null) return null;

  let color = 'text-gray-400';
  let dot = 'bg-gray-300';
  let badge = '';
  if (days < 0) { color = 'text-gray-400'; dot = 'bg-gray-300'; }
  else if (days <= 7) { color = 'text-red-600'; dot = 'bg-red-500'; badge = `${days}d left`; }
  else if (days <= 14) { color = 'text-amber-600'; dot = 'bg-amber-400'; badge = `${days}d left`; }
  else if (days <= 30) { color = 'text-amber-500'; dot = 'bg-amber-300'; badge = `${days}d left`; }

  return (
    <div className={`flex items-center gap-1.5 ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="text-xs whitespace-nowrap">{label}</span>
      {badge && <span className="text-xs font-medium px-1 py-0.5 rounded bg-current/10">{badge}</span>}
    </div>
  );
}

function TaskProgress({ tasks }: { tasks?: { status: string }[] }) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === 'completed').length;
  const pct = Math.round((done / tasks.length) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-24 bg-blue-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">{done}/{tasks.length} tasks</span>
    </div>
  );
}

interface Props {
  grant: GrantSummary;
  onStageChange: (id: string, newStage: string) => void;
  onDelete: (id: string) => void;
}

export default function ProposalCard({ grant, onStageChange, onDelete }: Props) {
  const [priority, setPriority] = useState(grant.priority);
  const [transition, setTransition] = useState<'submit' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isPersonal = grant.is_personal;
  const cardBg = isPersonal
    ? 'bg-white border-gray-200 border-dashed'
    : 'bg-blue-50/40 border-blue-100';

  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);

  return (
    <>
      {transition && (
        <StageTransitionModal
          grantId={grant.id}
          grantTitle={grant.title}
          transitionType={transition}
          onClose={() => setTransition(null)}
          onSuccess={(stage) => { setTransition(null); onStageChange(grant.id, stage); }}
        />
      )}
      <div className={`group border rounded-2xl px-5 py-4 hover:shadow-md hover:-translate-y-px transition-all duration-150 ${cardBg}`}>
        <div className="flex items-start gap-3">
          <Link href={`/grants/${grant.id}`} className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <PriorityTag grantId={grant.id} priority={priority} onUpdate={setPriority} />
              {isPersonal && (
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Personal</span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900 leading-snug group-hover:text-blue-700 transition-colors">
              {grant.title}
            </h3>
            {meta.length > 0 && (
              <p className="text-xs text-gray-400 mt-1 truncate">{meta.join(' · ')}</p>
            )}
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <DeadlineChip dateStr={grant.external_deadline} />
              <TaskProgress tasks={grant.tasks} />
            </div>
          </Link>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(v => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-gray-600 hover:bg-white/80 transition-colors"
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
                    onClick={() => { setMenuOpen(false); setTransition('submit'); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Mark as Submitted
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
            <Link
              href={`/grants/${grant.id}?tab=editor`}
              className="text-xs font-medium bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Write
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
