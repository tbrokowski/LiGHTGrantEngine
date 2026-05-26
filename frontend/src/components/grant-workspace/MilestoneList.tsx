'use client';

import { useState } from 'react';
import { Milestone, MILESTONE_STATUSES, getStatusStyle, getStatusLabel } from './types';
import { grants } from '@/lib/api';

interface Props {
  grantId: string;
  milestones: Milestone[];
  onRefresh: () => void;
}

const DEFAULT_MILESTONES = [
  'Go/no-go decision',
  'Proposal outline complete',
  'Budget shell complete',
  'Partner roles confirmed',
  'First full draft complete',
  'Budget complete',
  'Internal review complete',
  'PI approval complete',
  'Institutional approval complete',
  'Submission package complete',
  'Submitted',
  'Archived',
];

export default function MilestoneList({ grantId, milestones, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', target_date: '', status: 'upcoming', notes: '' });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Milestone>>({});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await grants.createMilestone(grantId, { ...form, target_date: form.target_date || null });
      setForm({ title: '', target_date: '', status: 'upcoming', notes: '' });
      setShowForm(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDefaults = async () => {
    for (const title of DEFAULT_MILESTONES) {
      await grants.createMilestone(grantId, { title, status: 'upcoming' });
    }
    onRefresh();
  };

  const handleStatusChange = async (m: Milestone, status: string) => {
    await grants.updateMilestone(grantId, m.id, { status });
    onRefresh();
  };

  const handleDelete = async (m: Milestone) => {
    if (!confirm(`Delete milestone "${m.title}"?`)) return;
    await grants.deleteMilestone(grantId, m.id);
    onRefresh();
  };

  const startEdit = (m: Milestone) => {
    setEditingId(m.id);
    setEditForm({ title: m.title, target_date: m.target_date ?? '', status: m.status, notes: m.notes ?? '' });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await grants.updateMilestone(grantId, editingId, editForm as Record<string, unknown>);
    setEditingId(null);
    onRefresh();
  };

  const sorted = [...milestones].sort((a, b) => {
    if (!a.target_date) return 1;
    if (!b.target_date) return -1;
    return a.target_date.localeCompare(b.target_date);
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">Milestones</h2>
        <div className="flex gap-2">
          {milestones.length === 0 && (
            <button
              onClick={handleGenerateDefaults}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              Generate Defaults
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + Milestone
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-3">
          <input
            required
            placeholder="Milestone title"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.target_date}
              onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
            />
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              {MILESTONE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No milestones yet. Add one or generate defaults.
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((m) => (
            <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-4">
              {editingId === m.id ? (
                <div className="space-y-2">
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    value={editForm.title ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      value={(editForm.target_date as string) ?? ''}
                      onChange={(e) => setEditForm((f) => ({ ...f, target_date: e.target.value }))}
                    />
                    <select
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      value={editForm.status ?? 'upcoming'}
                      onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    >
                      {MILESTONE_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Cancel</button>
                    <button onClick={saveEdit} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg">Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{m.title}</span>
                      <select
                        value={m.status}
                        onChange={(e) => handleStatusChange(m, e.target.value)}
                        className={`text-xs px-2 py-0.5 rounded-full border-0 ${getStatusStyle(MILESTONE_STATUSES, m.status)}`}
                      >
                        {MILESTONE_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    {m.target_date && (
                      <p className="text-xs text-gray-400 mt-0.5">Target: {m.target_date}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(m)} className="text-xs text-gray-400 hover:text-gray-600 px-1">Edit</button>
                    <button onClick={() => handleDelete(m)} className="text-xs text-red-400 hover:text-red-600 px-1">×</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
