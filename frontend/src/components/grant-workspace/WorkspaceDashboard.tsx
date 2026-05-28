'use client';

import { AlertTriangle, CalendarDays, CheckSquare, FileText, DollarSign, Folder, Users } from 'lucide-react';
import { WorkspaceSummary } from './types';

interface Props {
  summary: WorkspaceSummary;
  onTabChange: (tab: string) => void;
}

function formatDeadlineDate(dateStr: string | null) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

function deadlineTint(days: number | null): string {
  if (days === null) return 'bg-gray-50 border-gray-100';
  if (days < 0) return 'bg-red-50 border-red-100';
  if (days <= 7) return 'bg-red-50 border-red-100';
  if (days <= 14) return 'bg-orange-50 border-orange-100';
  if (days <= 30) return 'bg-amber-50 border-amber-100';
  return 'bg-gray-50 border-gray-100';
}

function deadlineDayColor(days: number | null): string {
  if (days === null) return 'text-gray-400';
  if (days < 0) return 'text-red-600';
  if (days <= 7) return 'text-red-600';
  if (days <= 14) return 'text-orange-500';
  if (days <= 30) return 'text-amber-500';
  return 'text-gray-700';
}

function DeadlineCard({ days, label, dateStr }: { days: number | null; label: string; dateStr: string | null }) {
  if (days === null && !dateStr) return null;
  const date = formatDeadlineDate(dateStr);
  const absDays = days !== null ? Math.abs(days) : null;
  const isOverdue = days !== null && days < 0;

  return (
    <div className={`flex-1 min-w-0 rounded-xl border px-4 py-3 ${deadlineTint(days)}`}>
      <div className={`text-2xl font-bold tabular-nums leading-none ${deadlineDayColor(days)}`}>
        {absDays !== null ? absDays : '—'}
        <span className="text-sm font-semibold ml-0.5">d</span>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mt-1.5">
        {isOverdue ? `${label} overdue` : label}
      </p>
      {date && <p className="text-xs text-gray-400 mt-0.5">{date}</p>}
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden mt-2">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function StatCard({
  label,
  complete,
  total,
  barColor,
  onClick,
}: {
  label: string;
  complete: number;
  total: number;
  barColor: string;
  onClick: () => void;
}) {
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  return (
    <button
      onClick={onClick}
      className="flex-1 min-w-0 text-left rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-gray-200 hover:shadow-sm transition-all group"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-gray-600 transition-colors">
        {label}
      </p>
      <p className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">
        {complete}
        <span className="text-sm font-normal text-gray-400"> / {total}</span>
      </p>
      <ProgressBar pct={pct} color={barColor} />
    </button>
  );
}

export default function WorkspaceDashboard({ summary, onTabChange }: Props) {
  const hasInternalDeadline = summary.days_to_internal_deadline !== null || summary.internal_deadline !== null;
  const hasExternalDeadline = summary.days_to_external_deadline !== null || summary.external_deadline !== null;
  const hasAlerts = summary.overdue_tasks > 0 || summary.blocked_tasks > 0 || summary.due_this_week_tasks > 0;
  const hasPendingPartners = summary.pending_partners > 0;
  const upcomingMilestones = summary.upcoming_milestones.slice(0, 5);

  const quickActions = [
    { label: 'Write', icon: FileText, tab: 'editor' },
    { label: 'Tasks', icon: CheckSquare, tab: 'tasks' },
    { label: 'Budget', icon: DollarSign, tab: 'budget' },
    { label: 'Files', icon: Folder, tab: 'files' },
    { label: 'Team', icon: Users, tab: 'team' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Title + funder */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 leading-snug">{summary.title}</h2>
        {summary.funder && <p className="text-xs text-gray-400 mt-0.5">{summary.funder}</p>}
      </div>

      {/* Deadline cards */}
      {(hasInternalDeadline || hasExternalDeadline) && (
        <div className="flex gap-3">
          {hasInternalDeadline && (
            <DeadlineCard
              days={summary.days_to_internal_deadline}
              label="Internal deadline"
              dateStr={summary.internal_deadline}
            />
          )}
          {hasExternalDeadline && (
            <DeadlineCard
              days={summary.days_to_external_deadline}
              label="External deadline"
              dateStr={summary.external_deadline}
            />
          )}
        </div>
      )}

      {/* Progress stat grid */}
      <div className="flex gap-3">
        <StatCard
          label="Tasks"
          complete={summary.complete_tasks}
          total={summary.total_tasks}
          barColor="bg-blue-400"
          onClick={() => onTabChange('tasks')}
        />
        <StatCard
          label="Sections"
          complete={summary.complete_sections}
          total={summary.total_sections}
          barColor="bg-indigo-400"
          onClick={() => onTabChange('more')}
        />
        <StatCard
          label="Checklist"
          complete={summary.complete_checklist_items}
          total={summary.total_checklist_items}
          barColor="bg-teal-400"
          onClick={() => onTabChange('tasks')}
        />
      </div>

      {/* Quick-action strip */}
      <div className="flex flex-wrap gap-2">
        {quickActions.map(({ label, icon: Icon, tab }) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:text-gray-900 hover:shadow-sm transition-all"
          >
            <Icon className="w-3.5 h-3.5 opacity-60" />
            {label}
          </button>
        ))}
      </div>

      {/* Alert banners */}
      {hasAlerts && (
        <div className="space-y-2">
          {summary.overdue_tasks > 0 && (
            <button
              onClick={() => onTabChange('tasks')}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-left hover:bg-red-100/60 transition-colors group"
            >
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-sm font-medium text-red-700">
                {summary.overdue_tasks} task{summary.overdue_tasks !== 1 ? 's' : ''} overdue
              </span>
              <span className="ml-auto text-xs text-red-400 group-hover:text-red-600">View →</span>
            </button>
          )}
          {summary.blocked_tasks > 0 && (
            <button
              onClick={() => onTabChange('tasks')}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-orange-50 border border-orange-100 text-left hover:bg-orange-100/60 transition-colors group"
            >
              <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="text-sm font-medium text-orange-700">
                {summary.blocked_tasks} task{summary.blocked_tasks !== 1 ? 's' : ''} blocked
              </span>
              <span className="ml-auto text-xs text-orange-400 group-hover:text-orange-600">View →</span>
            </button>
          )}
          {summary.due_this_week_tasks > 0 && summary.overdue_tasks === 0 && (
            <button
              onClick={() => onTabChange('tasks')}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-100 text-left hover:bg-amber-100/60 transition-colors group"
            >
              <CalendarDays className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-sm font-medium text-amber-700">
                {summary.due_this_week_tasks} task{summary.due_this_week_tasks !== 1 ? 's' : ''} due this week
              </span>
              <span className="ml-auto text-xs text-amber-400 group-hover:text-amber-600">View →</span>
            </button>
          )}
          {hasPendingPartners && (
            <button
              onClick={() => onTabChange('team')}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-left hover:bg-blue-100/60 transition-colors group"
            >
              <Users className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="text-sm font-medium text-blue-700">
                {summary.pending_partners} partner{summary.pending_partners !== 1 ? 's' : ''} pending confirmation
              </span>
              <span className="ml-auto text-xs text-blue-400 group-hover:text-blue-600">View →</span>
            </button>
          )}
        </div>
      )}
      {!hasAlerts && hasPendingPartners && (
        <button
          onClick={() => onTabChange('team')}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-left hover:bg-blue-100/60 transition-colors group"
        >
          <Users className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-sm font-medium text-blue-700">
            {summary.pending_partners} partner{summary.pending_partners !== 1 ? 's' : ''} pending confirmation
          </span>
          <span className="ml-auto text-xs text-blue-400 group-hover:text-blue-600">View →</span>
        </button>
      )}

      <div className="border-t border-gray-100" />

      {/* Upcoming milestones */}
      {upcomingMilestones.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Upcoming Milestones</p>
          {upcomingMilestones.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-indigo-400 transition-colors shrink-0" />
                <span className="text-sm text-gray-700 truncate">{m.title}</span>
              </div>
              {m.target_date && (
                <span className="shrink-0 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {new Date(m.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <CalendarDays className="w-4 h-4 opacity-50" />
          No upcoming milestones
        </div>
      )}
    </div>
  );
}
