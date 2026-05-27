'use client';

import { useMemo, useState, useCallback } from 'react';
import { Gantt, Task as GanttTask, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import type { Task } from './types';
import { grants } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  backlog:       '#cbd5e1',
  not_started:   '#94a3b8',
  in_progress:   '#6366f1',
  needs_input:   '#f59e0b',
  needs_review:  '#a855f7',
  blocked:       '#ef4444',
  complete:      '#22c55e',
  dropped:       '#9ca3af',
};

function taskProgress(status: string): number {
  if (status === 'complete') return 100;
  if (status === 'in_progress' || status === 'needs_review') return 50;
  return 0;
}

interface Props {
  tasks: Task[];
  compact?: boolean; // true = overview (read-only, Month), false = full interactive (Week)
  grantId?: string;  // when provided, enables drag write-back
  onRefresh?: () => void;
  grantColor?: string; // when set, tints all task bars with the grant's color
}

export default function TaskTimeline({ tasks, compact = false, grantId, onRefresh, grantColor }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(compact ? ViewMode.Month : ViewMode.Week);

  const { ganttTasks, undatedCount } = useMemo(() => {
    const datedTasks = tasks.filter((t) => t.start_date && t.due_date && t.status !== 'dropped');
    const undatedCount = tasks.filter((t) => (!t.start_date || !t.due_date) && t.status !== 'dropped').length;

    const ganttTasks: GanttTask[] = datedTasks.map((t) => {
      const start = new Date(t.start_date! + 'T00:00:00');
      let end = new Date(t.due_date! + 'T00:00:00');
      if (end <= start) {
        end = new Date(start.getTime() + 86400000);
      }
      const baseColor = STATUS_COLORS[t.status] ?? '#6366f1';
      const barColor = grantColor ?? baseColor;
      return {
        id: t.id,
        name: t.title,
        start,
        end,
        progress: taskProgress(t.status),
        type: 'task',
        isDisabled: compact || !grantId,
        styles: {
          backgroundColor: barColor,
          backgroundSelectedColor: barColor,
          progressColor: 'rgba(255,255,255,0.4)',
          progressSelectedColor: 'rgba(255,255,255,0.5)',
        },
      };
    });

    ganttTasks.sort((a, b) => a.start.getTime() - b.start.getTime());

    return { ganttTasks, undatedCount };
  }, [tasks, compact, grantId, grantColor]);

  const handleDateChange = useCallback(async (ganttTask: GanttTask) => {
    if (!grantId) return;
    const startStr = ganttTask.start.toISOString().split('T')[0];
    const endStr = ganttTask.end.toISOString().split('T')[0];
    await grants.updateTask(grantId, ganttTask.id, { start_date: startStr, due_date: endStr });
    onRefresh?.();
  }, [grantId, onRefresh]);

  if (ganttTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-gray-400 gap-2">
        <svg className="w-10 h-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="font-medium text-gray-500">No dated tasks yet</p>
        <p className="text-xs text-gray-400">Add start and due dates to tasks to see them here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Controls */}
      {!compact && (
        <div className="flex items-center gap-1 px-1">
          {([ViewMode.Week, ViewMode.Month] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                viewMode === mode
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="overflow-x-auto">
        <Gantt
          tasks={ganttTasks}
          viewMode={viewMode}
          listCellWidth={compact ? '120px' : '180px'}
          columnWidth={compact ? 40 : 60}
          rowHeight={compact ? 36 : 42}
          fontSize={compact ? '11px' : '12px'}
          todayColor="rgba(99,102,241,0.08)"
          onDateChange={!compact && grantId ? handleDateChange : undefined}
        />
      </div>

      {/* Legend + undated note */}
      <div className="flex flex-wrap items-center gap-4 px-1 pt-1">
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: 'Not started', color: STATUS_COLORS.not_started },
            { label: 'In progress', color: STATUS_COLORS.in_progress },
            { label: 'Needs review', color: STATUS_COLORS.needs_review },
            { label: 'Complete', color: STATUS_COLORS.complete },
            { label: 'Blocked', color: STATUS_COLORS.blocked },
          ].map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
        {undatedCount > 0 && (
          <span className="text-[10px] text-gray-400 ml-auto">
            {undatedCount} task{undatedCount !== 1 ? 's' : ''} without dates — add dates to see them here
          </span>
        )}
      </div>
    </div>
  );
}
