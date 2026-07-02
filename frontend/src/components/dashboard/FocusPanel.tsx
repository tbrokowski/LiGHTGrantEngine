'use client';
import Link from 'next/link';

export interface GrantItem {
  id: string;
  title: string;
  funder: string | null;
  status: string;
  priority: string | null;
  grant_stage: string;
  external_deadline: string | null;
  internal_deadline: string | null;
  color?: string | null;
}

export interface TaskItem {
  id: string;
  title: string;
  grant_id: string;
  grant_title: string;
  grant_color?: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  owner_id: string | null;
  assignee_ids: string[];
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  try {
    const diff = new Date(d).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-50 text-red-600',
  high:     'bg-orange-50 text-orange-600',
  medium:   'bg-amber-50 text-amber-600',
  low:      'bg-gray-100 text-gray-400',
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
};

const FOCUS_LIMIT = 5;

interface TaskRowProps {
  task: TaskItem;
  days: number | null;
}

function TaskRow({ task, days }: TaskRowProps) {
  const grantColor = task.grant_color ?? null;

  const urgencyDot =
    days !== null && days < 0  ? 'bg-red-400' :
    days !== null && days <= 7 ? 'bg-amber-400' :
    days !== null              ? 'bg-blue-300' :
                                 'bg-gray-200';

  const dayLabel =
    days === null   ? null :
    days < 0        ? `${Math.abs(days)}d overdue` :
    days === 0      ? 'Today' :
                      `${days}d`;

  const dayColor =
    days !== null && days < 0  ? 'text-red-500' :
    days !== null && days <= 7 ? 'text-amber-600' :
    days !== null              ? 'text-blue-500' :
                                 'text-gray-300';

  return (
    <Link
      href={`/grants/${task.grant_id}?tab=tasks`}
      className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50/80 transition-colors group"
      style={grantColor ? { borderLeft: `3px solid ${grantColor}` } : { borderLeft: '3px solid transparent' }}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgencyDot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate leading-snug">{task.title}</p>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {[task.grant_title, task.due_date ? formatDate(task.due_date) : null].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {task.priority && PRIORITY_LABEL[task.priority] && (
          <span className={`hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_COLOR[task.priority] ?? 'bg-gray-100 text-gray-500'}`}>
            {PRIORITY_LABEL[task.priority]}
          </span>
        )}
        {dayLabel && (
          <span className={`text-[11px] font-semibold tabular-nums w-16 text-right ${dayColor}`}>
            {dayLabel}
          </span>
        )}
      </div>
    </Link>
  );
}

interface FocusPanelProps {
  grants: GrantItem[];
  tasks: TaskItem[];
  loading: boolean;
  currentUserId?: string | null;
}

export default function FocusPanel({ tasks, loading }: FocusPanelProps) {
  const withDate = tasks
    .filter(t => t.due_date != null)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());

  const withoutDate = tasks
    .filter(t => t.due_date == null)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

  const sorted = [...withDate, ...withoutDate];
  const displayed = sorted.slice(0, FOCUS_LIMIT);
  const hiddenCount = sorted.length - displayed.length;

  const overdueCount = withDate.filter(t => (daysUntil(t.due_date) ?? 0) < 0).length;
  const dueSoonCount = withDate.filter(t => {
    const d = daysUntil(t.due_date);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  const summaryText = [
    overdueCount > 0 && `${overdueCount} overdue`,
    dueSoonCount > 0 && `${dueSoonCount} due soon`,
  ].filter(Boolean).join(' · ') || (sorted.length > 0 ? `${sorted.length} open` : 'All clear');

  return (
    <div
      className="overflow-hidden flex flex-col h-full"
      style={{
        background: 'var(--surface-base)',
        border: '1px solid var(--rule-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div
        className="px-4 py-3.5 flex items-center justify-between gap-2"
        style={{
          background: 'var(--panel-header-bg)',
          borderBottom: '1px solid var(--panel-header-rule)',
        }}
      >
        <h2
          className="text-sm font-semibold"
          style={{ color: 'var(--panel-header-text)' }}
        >
          Focus
        </h2>
        <p
          className="text-[10px] font-medium ml-auto shrink-0"
          style={{ color: 'var(--ink-muted)' }}
        >
          {summaryText}
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10">
          <div className="space-y-2 w-full px-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />
            ))}
          </div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 px-4 text-center">
          <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-500">No open tasks</p>
          <p className="text-xs text-gray-300 mt-1">Tasks assigned to you will appear here</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="overflow-y-auto divide-y divide-gray-50">
            {displayed.map(task => (
              <TaskRow key={task.id} task={task} days={daysUntil(task.due_date)} />
            ))}
          </div>
          {hiddenCount > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-50 mt-auto">
              <p className="text-[11px] text-gray-400 font-medium text-center">
                +{hiddenCount} more task{hiddenCount !== 1 ? 's' : ''} — open a grant to see all
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
