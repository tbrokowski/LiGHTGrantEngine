'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { grants } from '@/lib/api';
import type { Task } from './types';
import ReportingSchedule from '@/components/workspace/ReportingSchedule';

const TaskModal = dynamic(() => import('./TaskModal'), { ssr: false });

interface Milestone {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  completion_date: string | null;
  status: string;
  linked_tasks: string[];
  notes: string | null;
}

interface Props {
  grantId: string;
  allTasks: Task[];
  onTasksRefresh: () => void;
}

const MILESTONE_STATUS_STYLES: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700 border-blue-200',
  at_risk: 'bg-amber-100 text-amber-700 border-amber-200',
  complete: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  missed: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const MILESTONE_STATUS_LABELS: Record<string, string> = {
  upcoming: 'Upcoming',
  at_risk: 'At Risk',
  complete: 'Complete',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

const TASK_STATUS_STYLES: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  complete: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-red-100 text-red-700',
  dropped: 'bg-gray-50 text-gray-400',
  backlog: 'bg-gray-100 text-gray-500',
  review: 'bg-purple-100 text-purple-700',
};

function formatDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function DateBadge({ date }: { date: string | null }) {
  if (!date) return null;
  const days = daysUntil(date);
  const overdue = days !== null && days < 0;
  const urgent = days !== null && days <= 7 && !overdue;
  return (
    <span className={`text-xs ${overdue ? 'text-red-500' : urgent ? 'text-amber-600' : 'text-gray-400'}`}>
      {formatDate(date)}
      {days !== null && (
        <span className="ml-1">
          {overdue ? `(${Math.abs(days)}d overdue)` : days === 0 ? '(today)' : `(${days}d)`}
        </span>
      )}
    </span>
  );
}

function MilestoneRow({
  milestone,
  linkedTasks,
  grantId,
  onRefresh,
  onAddTask,
}: {
  milestone: Milestone;
  linkedTasks: Task[];
  grantId: string;
  onRefresh: () => void;
  onAddTask: (milestoneId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingStatus, setEditingStatus] = useState(false);

  const rootTasks = linkedTasks.filter(t => !t.parent_task_id);
  const subtasks = (parentId: string) => linkedTasks.filter(t => t.parent_task_id === parentId);
  const completedCount = linkedTasks.filter(t => t.status === 'complete').length;
  const hasChildren = rootTasks.length > 0;

  async function handleStatusChange(status: string) {
    try {
      await grants.updateMilestone(grantId, milestone.id, { status });
      onRefresh();
    } catch { /* ignore */ }
    setEditingStatus(false);
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Milestone header */}
      <div className="bg-white px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Milestone diamond icon */}
        <div className="w-3 h-3 rotate-45 shrink-0 bg-violet-500 rounded-sm" />

        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-900">{milestone.title}</span>
          {milestone.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{milestone.description}</p>
          )}
        </div>

        {/* Task count */}
        {hasChildren && (
          <span className="text-xs text-gray-400 shrink-0">
            {completedCount}/{linkedTasks.length} tasks
          </span>
        )}

        {/* Date */}
        <div className="shrink-0">
          <DateBadge date={milestone.target_date} />
        </div>

        {/* Status badge */}
        <div className="relative shrink-0">
          {editingStatus ? (
            <select
              autoFocus
              className="text-xs border border-gray-200 rounded-full px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              value={milestone.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              onBlur={() => setEditingStatus(false)}
            >
              {Object.keys(MILESTONE_STATUS_LABELS).map(s => (
                <option key={s} value={s}>{MILESTONE_STATUS_LABELS[s]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingStatus(true)}
              title="Click to change status"
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium border transition-colors hover:opacity-80 ${MILESTONE_STATUS_STYLES[milestone.status] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}
            >
              {MILESTONE_STATUS_LABELS[milestone.status] ?? milestone.status}
            </button>
          )}
        </div>

        {/* Add task */}
        <button
          onClick={() => onAddTask(milestone.id)}
          title="Add task to milestone"
          className="text-xs text-gray-400 hover:text-violet-600 transition-colors shrink-0 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>Task</span>
        </button>
      </div>

      {/* Tasks under milestone */}
      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {rootTasks.length === 0 ? (
            <div className="px-10 py-3 text-xs text-gray-400 italic">
              No tasks linked — click + Task to add one.
            </div>
          ) : (
            rootTasks.map(task => (
              <TaskRow key={task.id} task={task} subtasks={subtasks(task.id)} depth={1} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, subtasks, depth }: { task: Task; subtasks: Task[]; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasSubtasks = subtasks.length > 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-2 pr-4 hover:bg-gray-50 transition-colors"
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        {hasSubtasks ? (
          <button onClick={() => setExpanded(v => !v)} className="text-gray-300 hover:text-gray-500 shrink-0">
            <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Task circle */}
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 border-2 ${task.status === 'complete' ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`} />

        <span className={`flex-1 text-xs min-w-0 truncate ${task.status === 'complete' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
          {task.title}
        </span>

        {hasSubtasks && (
          <span className="text-[10px] text-gray-400 shrink-0">
            {subtasks.filter(s => s.status === 'complete').length}/{subtasks.length}
          </span>
        )}

        {task.due_date && (
          <span className={`text-[10px] shrink-0 ${
            task.status !== 'complete' && new Date(task.due_date) < new Date() ? 'text-red-500' : 'text-gray-400'
          }`}>
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}

        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${TASK_STATUS_STYLES[task.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {task.status.replace(/_/g, ' ')}
        </span>
      </div>

      {expanded && subtasks.map(sub => (
        <TaskRow key={sub.id} task={sub} subtasks={[]} depth={depth + 1} />
      ))}
    </>
  );
}

export default function MilestoneTracker({ grantId, allTasks, onTasksRefresh }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [newMilestone, setNewMilestone] = useState({ title: '', description: '', target_date: '', status: 'upcoming' });
  const [savingMilestone, setSavingMilestone] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [targetMilestoneId, setTargetMilestoneId] = useState<string | null>(null);

  const fetchMilestones = useCallback(() => {
    grants.listMilestones(grantId)
      .then(r => setMilestones(r.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { fetchMilestones(); }, [fetchMilestones]);

  async function handleAddMilestone() {
    if (!newMilestone.title.trim()) return;
    setSavingMilestone(true);
    try {
      await grants.createMilestone(grantId, {
        title: newMilestone.title.trim(),
        description: newMilestone.description.trim() || null,
        target_date: newMilestone.target_date || null,
        status: newMilestone.status,
      });
      fetchMilestones();
      setNewMilestone({ title: '', description: '', target_date: '', status: 'upcoming' });
      setAddingMilestone(false);
    } catch {
      alert('Failed to create milestone.');
    } finally {
      setSavingMilestone(false);
    }
  }

  function openAddTask(milestoneId: string) {
    setTargetMilestoneId(milestoneId);
    setTaskModalOpen(true);
  }

  async function handleSaveTask(data: Partial<Task>) {
    await grants.createTask(grantId, data as Record<string, unknown>);
    onTasksRefresh();
  }

  // Build a lookup: milestoneId → tasks linked to it (including subtasks of those tasks)
  const tasksByMilestone = (milestoneId: string): Task[] => {
    const direct = allTasks.filter(t => t.linked_milestone_id === milestoneId);
    const directIds = new Set(direct.map(t => t.id));
    const subtasks = allTasks.filter(t => t.parent_task_id && directIds.has(t.parent_task_id));
    return [...direct, ...subtasks];
  };

  const unlinkedTasks = allTasks.filter(t => !t.parent_task_id && !t.linked_milestone_id);

  if (loading) {
    return <div className="flex justify-center py-16 text-sm text-gray-400">Loading milestones…</div>;
  }

  return (
    <div className="p-4 space-y-8">
      {/* ── Milestones section ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Milestones</h2>
            <p className="text-xs text-gray-400 mt-0.5">Key deliverables with linked tasks and subtasks.</p>
          </div>
          <button
            onClick={() => setAddingMilestone(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-violet-700 border border-gray-200 hover:border-violet-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Milestone
          </button>
        </div>

        {/* Add milestone form */}
        {addingMilestone && (
          <div className="border border-violet-200 rounded-xl p-4 bg-violet-50 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 mb-1 block">Title *</label>
                <input
                  type="text"
                  value={newMilestone.title}
                  onChange={e => setNewMilestone(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Q2 Progress Report submitted"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Target Date</label>
                <input
                  type="date"
                  value={newMilestone.target_date}
                  onChange={e => setNewMilestone(p => ({ ...p, target_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
                <select
                  value={newMilestone.status}
                  onChange={e => setNewMilestone(p => ({ ...p, status: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                >
                  {Object.entries(MILESTONE_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
                <textarea
                  rows={2}
                  value={newMilestone.description}
                  onChange={e => setNewMilestone(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional description…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAddingMilestone(false)}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddMilestone}
                disabled={!newMilestone.title.trim() || savingMilestone}
                className="px-3 py-1.5 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors"
              >
                {savingMilestone ? 'Saving…' : 'Create Milestone'}
              </button>
            </div>
          </div>
        )}

        {milestones.length === 0 && !addingMilestone ? (
          <div className="text-center py-12 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
            <p>No milestones yet.</p>
            <button
              onClick={() => setAddingMilestone(true)}
              className="mt-2 text-xs text-violet-600 hover:underline"
            >
              Create your first milestone
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {milestones.map(m => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                linkedTasks={tasksByMilestone(m.id)}
                grantId={grantId}
                onRefresh={fetchMilestones}
                onAddTask={openAddTask}
              />
            ))}
          </div>
        )}

        {/* Unlinked tasks summary */}
        {unlinkedTasks.length > 0 && (
          <div className="border border-dashed border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Unlinked Tasks</span>
              <span className="text-xs text-gray-400">{unlinkedTasks.length} task{unlinkedTasks.length !== 1 ? 's' : ''} not assigned to a milestone</span>
            </div>
            <div className="divide-y divide-gray-50">
              {unlinkedTasks.map(t => (
                <TaskRow
                  key={t.id}
                  task={t}
                  subtasks={allTasks.filter(s => s.parent_task_id === t.id)}
                  depth={1}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Reporting Schedule ── */}
      <div className="border-t border-gray-100 pt-8">
        <ReportingSchedule grantId={grantId} />
      </div>

      {/* Task modal for adding tasks to milestones */}
      {taskModalOpen && (
        <TaskModal
          open={taskModalOpen}
          grantId={grantId}
          isActiveGrant={true}
          defaultMilestoneId={targetMilestoneId}
          onClose={() => { setTaskModalOpen(false); setTargetMilestoneId(null); }}
          onSave={handleSaveTask}
        />
      )}
    </div>
  );
}
