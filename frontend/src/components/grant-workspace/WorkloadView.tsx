'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Task, TASK_STATUSES, TASK_PRIORITIES } from './types';

interface Props {
  tasks: Task[];
}

const STATUS_COLORS: Record<string, string> = {
  backlog: '#e5e7eb',
  not_started: '#cbd5e1',
  in_progress: '#93c5fd',
  needs_input: '#fde68a',
  needs_review: '#c4b5fd',
  blocked: '#fca5a5',
  complete: '#6ee7b7',
  dropped: '#d1d5db',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#9ca3af',
};

const STATUS_LABELS = Object.fromEntries(TASK_STATUSES.map((s) => [s.value, s.label]));
const PRIORITY_LABELS = Object.fromEntries(TASK_PRIORITIES.map((p) => [p.value, p.label]));

function ownerLabel(id: string | null): string {
  if (!id) return 'Unassigned';
  return id.slice(0, 8);
}

export default function WorkloadView({ tasks }: Props) {
  const { chartData, ownerTaskMap } = useMemo(() => {
    const ownerMap: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      const key = t.owner_id ?? '__unassigned__';
      ownerMap[key] = ownerMap[key] ?? [];
      ownerMap[key].push(t);
    });

    const data = Object.entries(ownerMap).map(([ownerId, ownerTasks]) => {
      const row: Record<string, number | string> = {
        owner: ownerLabel(ownerId === '__unassigned__' ? null : ownerId),
      };
      TASK_STATUSES.forEach(({ value }) => {
        row[value] = ownerTasks.filter((t) => t.status === value).length;
      });
      row.total_effort = ownerTasks.reduce((sum, t) => sum + (t.estimated_effort ?? 0), 0);
      return row;
    });

    return { chartData: data, ownerTaskMap: ownerMap };
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400 text-sm py-16">
        No tasks yet. Add tasks with owners to see workload distribution.
      </div>
    );
  }

  const activeStatuses = TASK_STATUSES.filter(({ value }) =>
    chartData.some((row) => (row[value] as number) > 0),
  );

  const maxEffort = Math.max(...chartData.map((r) => r.total_effort as number), 1);
  const hasEffortData = chartData.some((r) => (r.total_effort as number) > 0);

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Workload Balancing</h2>
        <p className="text-xs text-gray-400">
          {Object.keys(ownerTaskMap).length} team member
          {Object.keys(ownerTaskMap).length !== 1 ? 's' : ''} · {tasks.length} tasks
        </p>
      </div>

      {/* Stacked bar chart: tasks by status per owner */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Task Count by Owner &amp; Status</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="owner" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(value, name) => [value, STATUS_LABELS[name as string] ?? name]}
            />
            <Legend
              formatter={(value) => STATUS_LABELS[value] ?? value}
              wrapperStyle={{ fontSize: 11 }}
            />
            {activeStatuses.map(({ value }) => (
              <Bar
                key={value}
                dataKey={value}
                stackId="a"
                fill={STATUS_COLORS[value] ?? '#e5e7eb'}
                radius={value === activeStatuses[activeStatuses.length - 1].value ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Effort bar chart */}
      {hasEffortData && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Estimated Effort (days)</h3>
          <div className="space-y-2.5">
            {chartData
              .filter((r) => (r.total_effort as number) > 0)
              .sort((a, b) => (b.total_effort as number) - (a.total_effort as number))
              .map((row) => {
                const effort = row.total_effort as number;
                const pct = (effort / maxEffort) * 100;
                const isHeavy = pct > 66;
                return (
                  <div key={String(row.owner)} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-20 shrink-0 truncate">{row.owner}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isHeavy ? 'bg-orange-400' : 'bg-indigo-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-14 text-right shrink-0">
                      {effort % 1 === 0 ? effort : effort.toFixed(1)}d
                    </span>
                  </div>
                );
              })}
          </div>
          {chartData.some((r) => (r.total_effort as number) > maxEffort * 0.66) && (
            <p className="text-xs text-orange-600 mt-3">
              Owners with orange bars carry more than 66% of the heaviest workload — consider
              redistributing tasks.
            </p>
          )}
        </div>
      )}

      {/* Per-owner cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(ownerTaskMap)
          .sort(([, a], [, b]) => b.length - a.length)
          .map(([ownerId, ownerTasks]) => {
            const label = ownerLabel(ownerId === '__unassigned__' ? null : ownerId);
            const incomplete = ownerTasks.filter((t) => t.status !== 'complete' && t.status !== 'dropped');
            const overdue = incomplete.filter(
              (t) => t.due_date && new Date(t.due_date) < new Date(),
            );
            return (
              <div key={ownerId} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-800">{label}</h4>
                  <div className="flex gap-2 text-xs">
                    <span className="text-gray-400">{ownerTasks.length} tasks</span>
                    {overdue.length > 0 && (
                      <span className="text-red-600 font-medium">{overdue.length} overdue</span>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {incomplete.slice(0, 5).map((t) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: STATUS_COLORS[t.status] ?? '#e5e7eb' }}
                      />
                      <span className="text-xs text-gray-700 truncate flex-1">{t.title}</span>
                      {t.priority && t.priority !== 'medium' && (
                        <span
                          className="text-xs shrink-0 font-medium"
                          style={{ color: PRIORITY_COLORS[t.priority] ?? '#9ca3af' }}
                        >
                          {PRIORITY_LABELS[t.priority]}
                        </span>
                      )}
                      {t.due_date && (
                        <span
                          className={`text-xs shrink-0 ${
                            new Date(t.due_date) < new Date()
                              ? 'text-red-500 font-medium'
                              : 'text-gray-400'
                          }`}
                        >
                          {t.due_date}
                        </span>
                      )}
                    </div>
                  ))}
                  {incomplete.length > 5 && (
                    <p className="text-xs text-gray-400 pt-1">
                      +{incomplete.length - 5} more open tasks
                    </p>
                  )}
                  {incomplete.length === 0 && (
                    <p className="text-xs text-green-600">All tasks complete</p>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
