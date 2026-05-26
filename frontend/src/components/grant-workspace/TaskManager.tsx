'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Task, TASK_STATUSES, getStatusStyle } from './types';
import { grants } from '@/lib/api';
import TaskModal from './TaskModal';

interface GrantMember {
  user_id: string | null;
  name: string | null;
  email: string;
}

interface Props {
  grantId: string;
  tasks: Task[];
  onRefresh: () => void;
  documentHeadings?: string[];
}

function priorityDot(priority: string) {
  const colors: Record<string, string> = {
    low: 'bg-gray-300',
    medium: 'bg-blue-500',
    high: 'bg-orange-500',
    critical: 'bg-red-600',
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[priority] ?? 'bg-gray-300'}`} />;
}

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === 'complete' || task.status === 'dropped') return false;
  return new Date(task.due_date + 'T00:00:00') < new Date();
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
}

function memberInitials(m: GrantMember): string {
  if (m.name) return m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return m.email[0].toUpperCase();
}

function AssigneeAvatars({ assigneeIds, members }: { assigneeIds: string[]; members: GrantMember[] }) {
  if (!assigneeIds?.length) return null;
  const matched = assigneeIds
    .map(uid => members.find(m => m.user_id === uid))
    .filter(Boolean) as GrantMember[];
  if (!matched.length) return null;
  return (
    <div className="flex -space-x-1 shrink-0">
      {matched.slice(0, 3).map((m) => (
        <span
          key={m.user_id}
          title={m.name ?? m.email}
          className="w-5 h-5 rounded-full bg-indigo-100 border border-white flex items-center justify-center text-[9px] font-bold text-indigo-700"
        >
          {memberInitials(m)}
        </span>
      ))}
      {matched.length > 3 && (
        <span className="w-5 h-5 rounded-full bg-gray-200 border border-white flex items-center justify-center text-[9px] text-gray-500 font-medium">
          +{matched.length - 3}
        </span>
      )}
    </div>
  );
}

/** Inline date picker that shows on click */
function InlineDateChip({
  date,
  overdue,
  onSave,
}: {
  date: string | null;
  overdue: boolean;
  onSave: (val: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={date ?? ''}
        className="text-xs border border-indigo-300 rounded px-1 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        onBlur={(e) => { onSave(e.target.value || null); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter') { onSave((e.target as HTMLInputElement).value || null); setEditing(false); } }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to edit date"
      className={`text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors ${overdue ? 'text-red-600 font-medium' : date ? 'text-gray-500' : 'text-gray-300 hover:text-gray-500'}`}
    >
      {date ? fmtDate(date) : '+ date'}
    </button>
  );
}

export default function TaskManager({ grantId, tasks, onRefresh, documentHeadings = [] }: Props) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [parentForNew, setParentForNew] = useState<string | null>(null);
  const [members, setMembers] = useState<GrantMember[]>([]);

  useEffect(() => {
    grants.listMembers(grantId)
      .then(r => setMembers(r.data))
      .catch(() => {});
  }, [grantId]);

  const rootTasks = tasks.filter((t) => !t.parent_task_id);
  const subtasks = (parentId: string) => tasks.filter((t) => t.parent_task_id === parentId);

  const toggleExpand = (id: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openNew = (parentId?: string) => {
    setEditingTask(null);
    setParentForNew(parentId ?? null);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setParentForNew(null);
    setModalOpen(true);
  };

  const handleSave = useCallback(async (data: Partial<Task>) => {
    if (editingTask) {
      await grants.updateTask(grantId, editingTask.id, data as Record<string, unknown>);
    } else {
      await grants.createTask(grantId, data as Record<string, unknown>);
    }
    onRefresh();
  }, [editingTask, grantId, onRefresh]);

  const handleDelete = async (task: Task) => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await grants.deleteTask(grantId, task.id);
    onRefresh();
  };

  const handleStatusChange = async (task: Task, status: string) => {
    await grants.updateTask(grantId, task.id, { status });
    onRefresh();
  };

  const handleDateSave = async (task: Task, field: 'due_date' | 'start_date', value: string | null) => {
    await grants.updateTask(grantId, task.id, { [field]: value });
    onRefresh();
  };

  const renderTask = (task: Task, depth = 0) => {
    const children = subtasks(task.id);
    const expanded = expandedTasks.has(task.id);
    const overdue = isOverdue(task);

    return (
      <div key={task.id}>
        <div
          className={`flex items-center gap-2 py-2 pr-3 hover:bg-gray-50 rounded-lg group ${overdue ? 'border-l-2 border-red-400' : 'border-l-2 border-transparent'}`}
          style={{ paddingLeft: `${depth * 20 + 10}px` }}
        >
          {/* Expand toggle */}
          {children.length > 0 ? (
            <button onClick={() => toggleExpand(task.id)} className="text-gray-400 w-4 shrink-0 text-xs">
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {priorityDot(task.priority)}

          {/* Title */}
          <span className={`flex-1 text-sm min-w-0 truncate ${task.status === 'complete' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {task.title}
            {depth > 0 && <span className="ml-1 text-xs text-gray-400">(subtask)</span>}
          </span>

          {/* Assignee avatars */}
          <AssigneeAvatars assigneeIds={task.assignee_ids ?? []} members={members} />

          {/* Due date inline chip */}
          <InlineDateChip
            date={task.due_date}
            overdue={overdue}
            onSave={(val) => handleDateSave(task, 'due_date', val)}
          />

          {/* Status select */}
          <select
            value={task.status}
            onChange={(e) => handleStatusChange(task, e.target.value)}
            className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer shrink-0 ${getStatusStyle(TASK_STATUSES, task.status)}`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Action buttons (visible on hover) */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={() => openNew(task.id)}
              title="Add subtask"
              className="text-xs text-indigo-500 hover:text-indigo-700 px-1 whitespace-nowrap"
            >
              + sub
            </button>
            <button onClick={() => openEdit(task)} className="text-xs text-gray-400 hover:text-gray-600 px-1">
              Edit
            </button>
            <button onClick={() => handleDelete(task)} className="text-xs text-red-400 hover:text-red-600 px-1">
              ×
            </button>
          </div>
        </div>
        {expanded && children.map((child) => renderTask(child, depth + 1))}
      </div>
    );
  };

  const overdueTasks = tasks.filter(isOverdue);
  const completePct = tasks.length > 0
    ? Math.round((tasks.filter((t) => t.status === 'complete').length / tasks.length) * 100)
    : 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-800">Tasks</h2>
          <span className="text-xs text-gray-500">{completePct}% complete</span>
          {overdueTasks.length > 0 && (
            <span className="text-xs text-red-600 font-medium">{overdueTasks.length} overdue</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => grants.applyTemplate(grantId).then(onRefresh)}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            Apply Template
          </button>
          <button
            onClick={() => openNew()}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + New Task
          </button>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="flex gap-2 flex-wrap">
        {TASK_STATUSES.map((s) => {
          const count = tasks.filter((t) => t.status === s.value).length;
          if (count === 0) return null;
          return (
            <span key={s.value} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${s.color}`}>
              {s.label} <span className="font-bold">{count}</span>
            </span>
          );
        })}
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No tasks yet.</p>
          <button onClick={() => openNew()} className="mt-2 text-xs text-indigo-600 hover:underline">
            Create your first task
          </button>
        </div>
      ) : (
        <div className="space-y-0.5 border border-gray-100 rounded-xl overflow-hidden bg-white">
          {rootTasks.map((t) => renderTask(t))}
        </div>
      )}

      <TaskModal
        open={modalOpen}
        task={editingTask}
        parentTaskId={parentForNew}
        grantId={grantId}
        documentHeadings={documentHeadings}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
