'use client';

import { WorkspaceSummary, MILESTONE_STATUSES, getStatusStyle, getStatusLabel } from './types';

interface Props {
  summary: WorkspaceSummary;
  onTabChange: (tab: string) => void;
}

function ProgressBar({ value, max, color = 'bg-indigo-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
    </div>
  );
}

function DeadlineBadge({ days, label }: { days: number | null; label: string }) {
  if (days === null) return null;
  const color =
    days < 0
      ? 'bg-red-50 border-red-200 text-red-700'
      : days <= 7
      ? 'bg-orange-50 border-orange-200 text-orange-700'
      : days <= 14
      ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
      : 'bg-green-50 border-green-200 text-green-700';
  return (
    <div className={`rounded-xl border px-4 py-3 ${color}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{Math.abs(days)}</p>
      <p className="text-xs">{days < 0 ? 'days overdue' : 'days remaining'}</p>
    </div>
  );
}

export default function WorkspaceDashboard({ summary, onTabChange }: Props) {
  const cards = [
    { label: 'Total Tasks', value: summary.total_tasks, sub: `${summary.complete_tasks} complete`, tab: 'tasks', color: 'text-indigo-600' },
    { label: 'Overdue', value: summary.overdue_tasks, sub: 'tasks past due', tab: 'tasks', color: summary.overdue_tasks > 0 ? 'text-red-600' : 'text-gray-700' },
    { label: 'Blocked', value: summary.blocked_tasks, sub: 'tasks blocked', tab: 'tasks', color: summary.blocked_tasks > 0 ? 'text-orange-600' : 'text-gray-700' },
    { label: 'Due This Week', value: summary.due_this_week_tasks, sub: 'tasks due soon', tab: 'tasks', color: 'text-yellow-700' },
    { label: 'Sections', value: summary.complete_sections, sub: `of ${summary.total_sections} sections`, tab: 'more', color: 'text-teal-600' },
    { label: 'Checklist', value: summary.complete_checklist_items, sub: `of ${summary.total_checklist_items} items`, tab: 'tasks', color: 'text-purple-600' },
    { label: 'Pending Partners', value: summary.pending_partners, sub: 'awaiting materials', tab: 'more', color: summary.pending_partners > 0 ? 'text-orange-600' : 'text-gray-700' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{summary.title}</h2>
        {summary.funder && <p className="text-sm text-gray-500 mt-0.5">{summary.funder}</p>}
      </div>

      {/* Deadline badges */}
      <div className="flex gap-3 flex-wrap">
        <DeadlineBadge days={summary.days_to_internal_deadline} label="Internal Deadline" />
        <DeadlineBadge days={summary.days_to_external_deadline} label="External Deadline" />
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-indigo-700">
          <p className="text-xs font-medium opacity-70">Overall Progress</p>
          <p className="text-2xl font-bold mt-0.5">{summary.completion_percentage}%</p>
          <p className="text-xs">tasks complete</p>
        </div>
      </div>

      {/* Progress bars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Task Progress</h3>
          <ProgressBar value={summary.complete_tasks} max={summary.total_tasks} color="bg-indigo-500" />
          <p className="text-xs text-gray-500">{summary.complete_tasks} of {summary.total_tasks} tasks complete</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Section Progress</h3>
          <ProgressBar value={summary.complete_sections} max={summary.total_sections} color="bg-teal-500" />
          <p className="text-xs text-gray-500">{summary.complete_sections} of {summary.total_sections} sections finalized</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Checklist Progress</h3>
          <ProgressBar value={summary.complete_checklist_items} max={summary.total_checklist_items} color="bg-purple-500" />
          <p className="text-xs text-gray-500">{summary.complete_checklist_items} of {summary.total_checklist_items} items complete</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Budget Status</h3>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700`}>
            {summary.budget_status.replace(/_/g, ' ')}
          </span>
          <button onClick={() => onTabChange('budget')} className="text-xs text-indigo-600 hover:underline block">View budget →</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => onTabChange(c.tab)}
            className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-indigo-300 transition-colors"
          >
            <p className="text-xs text-gray-500 font-medium">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
          </button>
        ))}
      </div>

      {/* Upcoming milestones */}
      {summary.upcoming_milestones.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Upcoming Milestones</h3>
          <div className="space-y-2">
            {summary.upcoming_milestones.map((m) => (
              <div key={m.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusStyle(MILESTONE_STATUSES, m.status)}`}>
                    {getStatusLabel(MILESTONE_STATUSES, m.status)}
                  </span>
                  <span className="text-sm text-gray-800">{m.title}</span>
                </div>
                {m.target_date && (
                  <span className="text-xs text-gray-500">{m.target_date}</span>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => onTabChange('tasks')} className="text-xs text-indigo-600 hover:underline mt-3 block">
            View timeline →
          </button>
        </div>
      )}
    </div>
  );
}
