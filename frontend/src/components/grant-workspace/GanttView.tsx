'use client';

import { useState, useMemo, useCallback } from 'react';
import { Gantt, Task as GanttTask, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { GanttItem } from './types';
import { grants } from '@/lib/api';

interface Props {
  grantId: string;
  items: GanttItem[];
  onRefresh: () => void;
}

const TYPE_BG: Record<string, string> = {
  task: '#6366f1',
  subtask: '#a5b4fc',
  milestone: '#a855f7',
  deadline: '#ef4444',
  review_period: '#eab308',
  partner_dependency: '#f97316',
  institutional_approval: '#14b8a6',
  submission_window: '#22c55e',
};

const CRITICAL_BG = '#dc2626';
const CRITICAL_SEL = '#b91c1c';

// ── Critical Path Method (CPM) ──────────────────────────────────────────────

function computeCriticalPath(items: GanttItem[]): Set<string> {
  const valid = items.filter((i) => i.start_date && i.end_date);
  if (valid.length < 2) return new Set(valid.map((i) => i.id));

  const durations: Record<string, number> = {};
  valid.forEach((i) => {
    durations[i.id] = Math.max(
      1,
      Math.ceil(
        (new Date(i.end_date!).getTime() - new Date(i.start_date!).getTime()) / 86400000,
      ) + 1,
    );
  });

  const succs: Record<string, string[]> = {};
  const preds: Record<string, string[]> = {};
  valid.forEach((i) => {
    succs[i.id] = succs[i.id] ?? [];
    preds[i.id] = preds[i.id] ?? [];
    (i.dependency_ids ?? []).forEach((dep) => {
      succs[dep] = succs[dep] ?? [];
      preds[dep] = preds[dep] ?? [];
      succs[dep].push(i.id);
      preds[i.id].push(dep);
    });
  });

  // Kahn's topological sort
  const inDeg: Record<string, number> = {};
  valid.forEach((i) => (inDeg[i.id] = (preds[i.id] ?? []).length));
  const queue = valid.filter((i) => inDeg[i.id] === 0).map((i) => i.id);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    (succs[n] ?? []).forEach((s) => {
      if (--inDeg[s] === 0) queue.push(s);
    });
  }

  // Forward pass: EF[id] = ES + duration
  const EF: Record<string, number> = {};
  order.forEach((id) => {
    const es = preds[id].length ? Math.max(...preds[id].map((p) => EF[p] ?? 0)) : 0;
    EF[id] = es + durations[id];
  });
  const projectEnd = Math.max(...Object.values(EF));

  // Backward pass: LF, LS
  const LS: Record<string, number> = {};
  const LF: Record<string, number> = {};
  [...order].reverse().forEach((id) => {
    LF[id] = succs[id].length ? Math.min(...succs[id].map((s) => LS[s])) : projectEnd;
    LS[id] = LF[id] - durations[id];
  });

  // Critical: slack (LS - ES) = 0
  const critical = new Set<string>();
  order.forEach((id) => {
    const es = preds[id].length ? Math.max(...preds[id].map((p) => EF[p] - durations[p])) : 0;
    if (LS[id] - es === 0) critical.add(id);
  });
  return critical;
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function toGanttTask(item: GanttItem, isCritical: boolean): GanttTask | null {
  if (!item.start_date || !item.end_date) return null;
  const start = new Date(item.start_date + 'T00:00:00');
  const end = new Date(item.end_date + 'T00:00:00');
  if (end <= start) end.setDate(end.getDate() + 1);

  const isMilestoneType = item.item_type === 'deadline' || item.item_type === 'milestone';
  const bg = isCritical ? CRITICAL_BG : (TYPE_BG[item.item_type] ?? '#6b7280');
  const bgSel = isCritical ? CRITICAL_SEL : bg;

  return {
    id: item.id,
    name: item.title,
    start,
    end,
    type: isMilestoneType ? 'milestone' : 'task',
    progress: item.status === 'complete' ? 100 : item.status === 'in_progress' ? 50 : 0,
    dependencies: item.dependency_ids ?? [],
    styles: {
      backgroundColor: bg,
      backgroundSelectedColor: bgSel,
      progressColor: bgSel,
      progressSelectedColor: bg,
    },
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GanttView({ grantId, items, onRefresh }: Props) {
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showCritical, setShowCritical] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);

  const criticalIds = useMemo(
    () => (showCritical ? computeCriticalPath(items) : new Set<string>()),
    [items, showCritical],
  );

  const ganttTasks = useMemo(
    () =>
      items.flatMap((i) => {
        const t = toGanttTask(i, criticalIds.has(i.id));
        return t ? [t] : [];
      }),
    [items, criticalIds],
  );

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await grants.generateGantt(grantId);
      onRefresh();
    } finally {
      setGenerating(false);
    }
  };

  const handleDateChange = useCallback(
    async (task: GanttTask, _children: GanttTask[]) => {
      await grants.updateGanttItem(grantId, task.id, {
        start_date: task.start.toISOString().split('T')[0],
        end_date: task.end.toISOString().split('T')[0],
      });
      onRefresh();
    },
    [grantId, onRefresh],
  );

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const { getApiBaseUrl } = await import('@/lib/api-base-url');
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/v1/grants/${grantId}/gantt/export-pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gantt-${grantId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('PDF export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  if (ganttTasks.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Gantt Chart</h2>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate from Tasks'}
          </button>
        </div>
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No Gantt items with dates yet.</p>
          <p className="text-xs mt-1">Add tasks with start/due dates, then generate the chart.</p>
        </div>
      </div>
    );
  }

  const colWidth = viewMode === ViewMode.Month ? 300 : viewMode === ViewMode.Week ? 250 : 65;

  return (
    <div className="p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-800">Gantt Chart</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode selector */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {([ViewMode.Day, ViewMode.Week, ViewMode.Month] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 ${
                  viewMode === m ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Critical path toggle */}
          <button
            onClick={() => setShowCritical((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              showCritical
                ? 'bg-red-600 text-white border-red-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {showCritical ? 'Hide Critical Path' : 'Show Critical Path'}
          </button>

          {/* Export PDF */}
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>

          {/* Regenerate */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {generating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>

      {/* Critical path notice */}
      {showCritical && criticalIds.size > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          {criticalIds.size} item{criticalIds.size !== 1 ? 's' : ''} on the critical path (shown
          in red). Any delay here extends the overall project timeline.
        </div>
      )}

      {/* Chart — drag bars to reschedule */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <Gantt
          tasks={ganttTasks}
          viewMode={viewMode}
          onDateChange={handleDateChange}
          columnWidth={colWidth}
          listCellWidth="200px"
          rowHeight={40}
          fontSize="12px"
          barCornerRadius={4}
          ganttHeight={Math.min(ganttTasks.length * 50 + 60, 600)}
        />
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs text-gray-500">
        {Object.entries(TYPE_BG).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: color }} />
            {type.replace(/_/g, ' ')}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: CRITICAL_BG }} />
          critical path
        </span>
      </div>
    </div>
  );
}
