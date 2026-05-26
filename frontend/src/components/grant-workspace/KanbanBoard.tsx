'use client';

import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Task, TASK_STATUSES, TASK_PRIORITIES, getStatusLabel } from './types';
import { grants } from '@/lib/api';
import { useState } from 'react';
import TaskModal from './TaskModal';

const KANBAN_COLUMNS = ['backlog', 'not_started', 'in_progress', 'needs_review', 'complete'];

interface Props {
  grantId: string;
  tasks: Task[];
  onRefresh: () => void;
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    low: 'text-gray-400',
    medium: 'text-blue-500',
    high: 'text-orange-500',
    critical: 'text-red-600 font-bold',
  };
  return <span className={`text-xs ${colors[priority] ?? 'text-gray-400'}`}>{priority}</span>;
}

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === 'complete' || task.status === 'dropped') return false;
  return new Date(task.due_date) < new Date();
}

export default function KanbanBoard({ grantId, tasks, onRefresh }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultStatus, setDefaultStatus] = useState('not_started');

  const rootTasks = tasks.filter((t) => !t.parent_task_id);
  const byStatus = (status: string) => rootTasks.filter((t) => t.status === status);

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const taskId = result.draggableId;
    if (newStatus === result.source.droppableId) return;
    await grants.updateTask(grantId, taskId, { status: newStatus });
    onRefresh();
  };

  const handleSave = async (data: Partial<Task>) => {
    if (editingTask) {
      await grants.updateTask(grantId, editingTask.id, data as Record<string, unknown>);
    } else {
      await grants.createTask(grantId, data as Record<string, unknown>);
    }
    onRefresh();
  };

  return (
    <div className="p-4">
      <h2 className="text-base font-semibold text-gray-800 mb-4">Kanban Board</h2>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((status) => {
            const colTasks = byStatus(status);
            const statusInfo = TASK_STATUSES.find((s) => s.value === status);
            return (
              <div key={status} className="flex-shrink-0 w-60">
                <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${statusInfo?.color ?? 'bg-gray-100'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold truncate">{getStatusLabel(TASK_STATUSES, status)}</span>
                    <span className="text-xs font-bold text-gray-500">{colTasks.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTask(null);
                      setDefaultStatus(status);
                      setModalOpen(true);
                    }}
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-indigo-700 hover:bg-white/70 text-sm font-bold leading-none transition-colors"
                    title={`Add task to ${getStatusLabel(TASK_STATUSES, status)}`}
                    aria-label={`Add task to ${getStatusLabel(TASK_STATUSES, status)}`}
                  >
                    +
                  </button>
                </div>
                <Droppable droppableId={status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-32 rounded-b-lg p-2 space-y-2 border border-t-0 border-gray-200 transition-colors ${
                        snapshot.isDraggingOver ? 'bg-indigo-50' : 'bg-gray-50'
                      }`}
                    >
                      {colTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              onClick={() => { setEditingTask(task); setDefaultStatus(task.status); setModalOpen(true); }}
                              className={`bg-white rounded-lg border p-2.5 cursor-pointer hover:border-indigo-300 transition-colors text-left ${
                                snapshot.isDragging ? 'shadow-lg border-indigo-400' : 'border-gray-200'
                              } ${task.status === 'blocked' ? 'border-l-2 border-l-red-500' : isOverdue(task) ? 'border-l-2 border-l-amber-400' : ''}`}
                            >
                              <p className="text-xs font-medium text-gray-800 leading-snug">{task.title}</p>
                              {task.status === 'blocked' && (
                                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                                  Blocked
                                </span>
                              )}
                              <div className="flex items-center justify-between mt-2">
                                <PriorityBadge priority={task.priority} />
                                {task.due_date && (
                                  <span className={`text-xs ${isOverdue(task) ? 'text-red-600' : 'text-gray-400'}`}>
                                    {task.due_date}
                                  </span>
                                )}
                              </div>
                              {tasks.filter((t) => t.parent_task_id === task.id).length > 0 && (
                                <p className="text-xs text-gray-400 mt-1">
                                  {tasks.filter((t) => t.parent_task_id === task.id && t.status === 'complete').length}/
                                  {tasks.filter((t) => t.parent_task_id === task.id).length} subtasks
                                </p>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {colTasks.length === 0 && !snapshot.isDraggingOver && (
                        <p className="text-xs text-gray-300 text-center py-4">Drop here</p>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      <TaskModal
        open={modalOpen}
        task={editingTask}
        parentTaskId={null}
        defaultStatus={defaultStatus}
        grantId={grantId}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
