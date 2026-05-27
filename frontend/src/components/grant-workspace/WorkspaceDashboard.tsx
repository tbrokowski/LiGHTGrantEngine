'use client';

import { ChevronRight } from 'lucide-react';
import { WorkspaceSummary } from './types';

interface Props {
  summary: WorkspaceSummary;
  onTabChange: (tab: string) => void;
}

function deadlineColor(days: number | null): string {
  if (days === null) return 'text-gray-400';
  if (days < 0) return 'text-red-600';
  if (days <= 7) return 'text-red-600';
  if (days <= 14) return 'text-orange-500';
  return 'text-gray-600';
}

function deadlineLabel(days: number | null, label: string): string | null {
  if (days === null) return null;
  if (days < 0) return `${Math.abs(days)}d overdue (${label.toLowerCase()})`;
  return `${days} days to ${label.toLowerCase()}`;
}

export default function WorkspaceDashboard({ summary, onTabChange }: Props) {
  const internalLabel = deadlineLabel(summary.days_to_internal_deadline, 'internal deadline');
  const externalLabel = deadlineLabel(summary.days_to_external_deadline, 'external deadline');

  const deadlineParts = [internalLabel, externalLabel].filter(Boolean);

  const hasAlerts = summary.overdue_tasks > 0 || summary.blocked_tasks > 0;

  const upcomingMilestones = summary.upcoming_milestones.slice(0, 5);

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      {/* Title */}
      <div>
        <h2 className="text-base font-semibold text-gray-900">{summary.title}</h2>
        {summary.funder && <p className="text-xs text-gray-400 mt-0.5">{summary.funder}</p>}
      </div>

      {/* Deadline line */}
      {deadlineParts.length > 0 && (
        <p className="text-sm">
          {deadlineParts.map((part, i) => {
            const days = i === 0 ? summary.days_to_internal_deadline : summary.days_to_external_deadline;
            return (
              <span key={i}>
                {i > 0 && <span className="text-gray-300 mx-2">·</span>}
                <span className={deadlineColor(days)}>{part}</span>
              </span>
            );
          })}
        </p>
      )}

      {/* Progress line */}
      <p className="text-sm text-gray-600">
        <button
          onClick={() => onTabChange('tasks')}
          className="hover:text-indigo-600 transition-colors"
        >
          Tasks {summary.complete_tasks}/{summary.total_tasks}
        </button>
        <span className="text-gray-300 mx-2">·</span>
        <button
          onClick={() => onTabChange('more')}
          className="hover:text-indigo-600 transition-colors"
        >
          Sections {summary.complete_sections}/{summary.total_sections}
        </button>
        <span className="text-gray-300 mx-2">·</span>
        <button
          onClick={() => onTabChange('tasks')}
          className="hover:text-indigo-600 transition-colors"
        >
          Checklist {summary.complete_checklist_items}/{summary.total_checklist_items}
        </button>
      </p>

      {/* Alerts line — only when relevant */}
      {hasAlerts && (
        <p className="text-sm">
          {summary.overdue_tasks > 0 && (
            <span className="text-red-600">
              {summary.overdue_tasks} task{summary.overdue_tasks !== 1 ? 's' : ''} overdue
            </span>
          )}
          {summary.overdue_tasks > 0 && summary.blocked_tasks > 0 && (
            <span className="text-gray-300 mx-2">·</span>
          )}
          {summary.blocked_tasks > 0 && (
            <span className="text-orange-500">
              {summary.blocked_tasks} blocked
            </span>
          )}
        </p>
      )}

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Upcoming milestones */}
      {upcomingMilestones.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Upcoming</p>
          {upcomingMilestones.map((m) => (
            <div key={m.id} className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-gray-800">→ {m.title}</span>
              {m.target_date && (
                <span className="text-xs text-gray-400 shrink-0">{m.target_date}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No upcoming milestones</p>
      )}

      <button
        onClick={() => onTabChange('tasks')}
        className="flex items-center gap-0.5 text-xs text-indigo-600 hover:underline"
      >
        View all tasks <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
