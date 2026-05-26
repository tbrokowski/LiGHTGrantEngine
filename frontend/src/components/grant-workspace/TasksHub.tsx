'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import TaskManager from './TaskManager';
import KanbanBoard from './KanbanBoard';
import TaskTimeline from './TaskTimeline';
import GanttView from './GanttView';
import ChecklistPanel from './ChecklistPanel';
import WorkloadView from './WorkloadView';
import type { Task, ChecklistItem, GanttItem } from './types';
import { grants } from '@/lib/api';

type HubView = 'board' | 'list' | 'timeline' | 'gantt' | 'checklist';

const VIEWS: { id: HubView; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'list', label: 'List' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'checklist', label: 'Checklist' },
];

interface Props {
  grantId: string;
  tasks: Task[];
  onRefresh: () => void;
  documentHeadings?: string[];
}

function StatChip({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${accent ?? 'bg-white border-gray-200 text-gray-600'}`}>
      <span className="text-base font-bold leading-none">{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

export default function TasksHub({ grantId, tasks, onRefresh, documentHeadings = [] }: Props) {
  const [view, setView] = useState<HubView>('board');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistLoaded, setChecklistLoaded] = useState(false);
  const [ganttItems, setGanttItems] = useState<GanttItem[]>([]);
  const [ganttLoaded, setGanttLoaded] = useState(false);

  const fetchChecklist = useCallback(() => {
    grants.listChecklist(grantId).then((r) => {
      setChecklist(r.data);
      setChecklistLoaded(true);
    }).catch(console.error);
  }, [grantId]);

  const fetchGantt = useCallback(() => {
    grants.listGantt(grantId).then((r) => {
      setGanttItems(r.data);
      setGanttLoaded(true);
    }).catch(console.error);
  }, [grantId]);

  useEffect(() => {
    if (view === 'checklist' && !checklistLoaded) {
      fetchChecklist();
    }
    if (view === 'gantt' && !ganttLoaded) {
      fetchGantt();
    }
  }, [view, checklistLoaded, fetchChecklist, ganttLoaded, fetchGantt]);

  const stats = useMemo(() => {
    const active = tasks.filter((t) => !['complete', 'dropped', 'backlog'].includes(t.status));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = tasks.filter(
      (t) => t.due_date && t.status !== 'complete' && t.status !== 'dropped' && new Date(t.due_date) < today
    ).length;
    const critical = tasks.filter((t) => t.priority === 'critical' && t.status !== 'complete').length;
    return { active: active.length, overdue, critical };
  }, [tasks]);

  return (
    <div className="flex flex-col h-full">
      {/* Secondary nav */}
      <div className="px-4 pt-3 pb-0 border-b border-gray-100 bg-white flex items-center gap-2">
        <div className="flex gap-1 mr-3">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === v.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        {(view === 'board' || view === 'list') && (
          <div className="flex items-center gap-2 ml-auto">
            <StatChip label="active" value={stats.active} />
            {stats.overdue > 0 && (
              <StatChip label="overdue" value={stats.overdue} accent="bg-red-50 border-red-200 text-red-700" />
            )}
            {stats.critical > 0 && (
              <StatChip label="critical" value={stats.critical} accent="bg-orange-50 border-orange-200 text-orange-700" />
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'board' && (
          <KanbanBoard grantId={grantId} tasks={tasks} onRefresh={onRefresh} />
        )}

        {view === 'list' && (
          <div>
            <TaskManager
              grantId={grantId}
              tasks={tasks}
              onRefresh={onRefresh}
              documentHeadings={documentHeadings}
            />
            {tasks.length > 0 && (
              <div className="border-t border-gray-100 mt-2 pt-2">
                <div className="px-4 pb-2">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Workload Analytics</h3>
                </div>
                <WorkloadView tasks={tasks} />
              </div>
            )}
          </div>
        )}

        {view === 'timeline' && (
          <div className="p-4">
            {tasks.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                No tasks yet. Create tasks with start and due dates to see them on the timeline.
              </div>
            ) : (
              <TaskTimeline
                tasks={tasks}
                compact={false}
                grantId={grantId}
                onRefresh={onRefresh}
              />
            )}
          </div>
        )}

        {view === 'gantt' && (
          ganttLoaded ? (
            <GanttView
              grantId={grantId}
              items={ganttItems}
              onRefresh={fetchGantt}
            />
          ) : (
            <div className="flex justify-center py-12 text-sm text-gray-400">Loading…</div>
          )
        )}

        {view === 'checklist' && (
          checklistLoaded ? (
            <ChecklistPanel grantId={grantId} items={checklist} onRefresh={fetchChecklist} />
          ) : (
            <div className="flex justify-center py-12 text-sm text-gray-400">Loading…</div>
          )
        )}
      </div>
    </div>
  );
}
