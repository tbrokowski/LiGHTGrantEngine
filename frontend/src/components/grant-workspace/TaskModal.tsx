'use client';

import { useState, useEffect } from 'react';
import { Task, TASK_STATUSES, TASK_PRIORITIES } from './types';
import { grants } from '@/lib/api';

interface GrantMemberOption {
  id: string;
  user_id: string | null;
  name: string | null;
  email: string;
}

const TASK_TYPES = [
  'eligibility_check', 'call_analysis', 'concept_note', 'narrative_writing', 'specific_aims',
  'background', 'methods', 'implementation_plan', 'mel_evaluation', 'ethics', 'data_management',
  'budget', 'budget_justification', 'partner_letter', 'cv_biosketch', 'institutional_approval',
  'compliance_check', 'formatting', 'submission_portal', 'final_upload', 'post_submission_archive', 'other',
];

interface Props {
  open: boolean;
  task?: Task | null;
  parentTaskId?: string | null;
  grantId: string;
  documentHeadings?: string[];
  onClose: () => void;
  onSave: (data: Partial<Task>) => Promise<void>;
}

function memberLabel(m: GrantMemberOption): string {
  return m.name ? `${m.name} (${m.email})` : m.email;
}

export default function TaskModal({ open, task, parentTaskId, grantId, documentHeadings = [], onClose, onSave }: Props) {
  const [form, setForm] = useState<Partial<Task>>({});
  const [saving, setSaving] = useState(false);
  const [memberList, setMemberList] = useState<GrantMemberOption[]>([]);

  useEffect(() => {
    if (open) {
      grants.listMembers(grantId)
        .then((r) => setMemberList(r.data))
        .catch(() => setMemberList([]));
    }
  }, [open, grantId]);

  useEffect(() => {
    if (task) {
      setForm({ ...task, assignee_ids: task.assignee_ids ?? [] });
    } else {
      setForm({
        title: '',
        description: '',
        status: 'not_started',
        priority: 'medium',
        task_type: 'other',
        parent_task_id: parentTaskId ?? null,
        due_date: null,
        start_date: null,
        estimated_effort: null,
        assignee_ids: [],
        dependencies: [],
      });
    }
  }, [task, parentTaskId, open]);

  if (!open) return null;

  const set = (key: keyof Task, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  function toggleAssignee(userId: string) {
    const current = (form.assignee_ids ?? []) as string[];
    if (current.includes(userId)) {
      set('assignee_ids', current.filter(id => id !== userId));
    } else {
      set('assignee_ids', [...current, userId]);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const assignableMembers = memberList.filter(m => m.user_id);
  const selectedAssignees = (form.assignee_ids ?? []) as string[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {task ? 'Edit Task' : parentTaskId ? 'Add Subtask' : 'New Task'}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={form.title ?? ''}
              onChange={(e) => set('title', e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.status ?? 'not_started'}
                onChange={(e) => set('status', e.target.value)}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.priority ?? 'medium'}
                onChange={(e) => set('priority', e.target.value)}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Task Type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Task Type</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={form.task_type ?? 'other'}
              onChange={(e) => set('task_type', e.target.value)}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.start_date ?? ''}
                onChange={(e) => set('start_date', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.due_date ?? ''}
                onChange={(e) => set('due_date', e.target.value || null)}
              />
            </div>
          </div>

          {/* Assignees (multi-select from grant members) */}
          {assignableMembers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Assigned To
                <span className="text-gray-400 font-normal ml-1">(select all that apply)</span>
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {assignableMembers.map(m => {
                  const uid = m.user_id!;
                  const checked = selectedAssignees.includes(uid);
                  return (
                    <label
                      key={uid}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 ${checked ? 'bg-indigo-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignee(uid)}
                        className="accent-indigo-600"
                      />
                      <span className="text-sm text-gray-800">{memberLabel(m)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Estimated effort */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estimated Effort (hours)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={form.estimated_effort ?? ''}
              onChange={(e) => set('estimated_effort', e.target.value ? parseFloat(e.target.value) : null)}
            />
          </div>

          {/* Document URL */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Document URL</label>
            <input
              type="url"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="https://..."
              value={form.document_url ?? ''}
              onChange={(e) => set('document_url', e.target.value || null)}
            />
          </div>

          {/* Link to document section */}
          {documentHeadings.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Link to Document Section
              </label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.linked_section_id ?? ''}
                onChange={(e) => set('linked_section_id', e.target.value || null)}
              >
                <option value="">— None —</option>
                {documentHeadings.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Linking a section makes this task appear in the document outline.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
