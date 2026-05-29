'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, CheckSquare, Square, Trash2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import ConfirmModal from '@/components/ui/ConfirmModal';

interface Task {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  due_date?: string;
  assigned_to?: string;
  assignee_name?: string;
  completed_at?: string;
  created_at?: string;
}

const PRIORITY_CONFIG = {
  low: { color: 'bg-gray-300', label: 'Low' },
  normal: { color: 'bg-blue-400', label: 'Normal' },
  high: { color: 'bg-orange-400', label: 'High' },
  urgent: { color: 'bg-red-500', label: 'Urgent' },
};

function formatDueDate(d?: string) {
  if (!d) return null;
  const date = new Date(d);
  const now = new Date();
  const isOverdue = date < now;
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { formatted, isOverdue };
}

interface TaskPanelProps {
  partnerId: string;
  onTaskCountChange?: (count: number) => void;
  defaultOpen?: boolean;
}

export default function TaskPanel({ partnerId, onTaskCountChange, defaultOpen = false }: TaskPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(defaultOpen);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [newDue, setNewDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await partnersApi.listTasks(partnerId);
      const data: Task[] = res.data || [];
      setTasks(data);
      const openCount = data.filter(t => t.status === 'open' || t.status === 'in_progress').length;
      onTaskCountChange?.(openCount);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [partnerId, onTaskCountChange]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await partnersApi.createTask(partnerId, {
        title: newTitle.trim(),
        priority: newPriority,
        due_date: newDue || null,
      });
      setNewTitle(''); setNewPriority('normal'); setNewDue('');
      setShowAdd(false);
      fetchTasks();
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(task: Task) {
    if (task.status === 'done') return;
    try {
      await partnersApi.completeTask(partnerId, task.id);
      fetchTasks();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await partnersApi.deleteTask(partnerId, id);
      fetchTasks();
    } catch { /* ignore */ }
    setDeleteId(null);
  }

  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
  const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'cancelled');

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">Tasks</span>
          {openTasks.length > 0 && (
            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">
              {openTasks.length}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-3">
          {loading ? (
            <div className="py-4 space-y-2 animate-pulse">
              {[1, 2].map(i => <div key={i} className="h-8 bg-gray-100 rounded-lg" />)}
            </div>
          ) : (
            <>
              {/* Open tasks */}
              <div className="pt-2 space-y-1">
                {openTasks.length === 0 && !showAdd && (
                  <p className="text-xs text-gray-400 text-center py-3">No open tasks</p>
                )}
                {openTasks.map(task => {
                  const due = formatDueDate(task.due_date);
                  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.normal;
                  return (
                    <div key={task.id} className="flex items-start gap-2 group py-1.5 rounded-lg hover:bg-gray-50 px-1">
                      <button
                        onClick={() => handleComplete(task)}
                        className="mt-0.5 shrink-0 text-gray-300 hover:text-green-500 transition-colors"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${priority.color}`} title={priority.label} />
                          <span className="text-sm text-gray-800 truncate">{task.title}</span>
                        </div>
                        {due && (
                          <span className={`text-xs flex items-center gap-0.5 mt-0.5 ${due.isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                            {due.isOverdue && <AlertCircle className="w-3 h-3" />}
                            {due.formatted}
                          </span>
                        )}
                        {task.assignee_name && (
                          <span className="text-xs text-gray-400">{task.assignee_name}</span>
                        )}
                      </div>
                      <button
                        onClick={() => setDeleteId(task.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-red-500 transition-opacity shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Quick add */}
              {showAdd ? (
                <form onSubmit={handleAdd} className="mt-2 space-y-2 bg-gray-50 rounded-lg p-2.5 border border-gray-200">
                  <input
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    placeholder="Task title…"
                    autoFocus
                    className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <select
                      value={newPriority}
                      onChange={e => setNewPriority(e.target.value as Task['priority'])}
                      className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <input
                      type="date"
                      value={newDue}
                      onChange={e => setNewDue(e.target.value)}
                      className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowAdd(false)}
                      className="text-xs px-2.5 py-1 text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
                    <button type="submit" disabled={saving}
                      className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                      {saving ? 'Adding…' : 'Add Task'}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowAdd(true)}
                  className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 transition-colors py-1"
                >
                  <Plus className="w-3.5 h-3.5" />Add task
                </button>
              )}

              {/* Completed tasks toggle */}
              {doneTasks.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => setShowDone(!showDone)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                  >
                    {showDone ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {doneTasks.length} completed
                  </button>
                  {showDone && (
                    <div className="mt-1 space-y-1">
                      {doneTasks.map(task => (
                        <div key={task.id} className="flex items-center gap-2 py-1 px-1 opacity-50">
                          <CheckSquare className="w-4 h-4 text-green-500 shrink-0" />
                          <span className="text-xs text-gray-500 line-through truncate">{task.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {deleteId && (
        <ConfirmModal
          title="Delete task?"
          message="This task will be permanently removed."
          confirmLabel="Delete"
          destructive
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
