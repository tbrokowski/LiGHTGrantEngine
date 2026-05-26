'use client';

import { useState } from 'react';
import { WorkspaceSection, SECTION_STATUSES, getStatusStyle } from './types';
import { grants } from '@/lib/api';

const SECTION_TYPES = [
  'abstract', 'executive_summary', 'problem_statement', 'background', 'specific_aims',
  'objectives', 'innovation', 'methods', 'implementation_plan', 'work_packages', 'timeline',
  'governance', 'team_capacity', 'partnerships', 'mel_evaluation', 'ethics', 'data_governance',
  'risk_mitigation', 'sustainability', 'budget_justification', 'impact_statement', 'dissemination', 'other',
];

interface Props {
  grantId: string;
  sections: WorkspaceSection[];
  onRefresh: () => void;
  onOpenEditor: () => void;
}

export default function SectionTracker({ grantId, sections, onRefresh, onOpenEditor }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', section_type: 'other', word_limit: '', requirement_text: '', due_date: '' });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await grants.createWorkspaceSection(grantId, {
        ...form,
        word_limit: form.word_limit ? parseInt(form.word_limit) : null,
        due_date: form.due_date || null,
        display_order: sections.length,
      });
      setForm({ title: '', section_type: 'other', word_limit: '', requirement_text: '', due_date: '' });
      setShowForm(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (s: WorkspaceSection, status: string) => {
    await grants.updateWorkspaceSection(grantId, s.id, { status });
    onRefresh();
  };

  const handleDelete = async (s: WorkspaceSection) => {
    if (!confirm(`Delete section "${s.title}"?`)) return;
    await grants.deleteWorkspaceSection(grantId, s.id);
    onRefresh();
  };

  const completeCount = sections.filter((s) => ['approved', 'finalized', 'submitted'].includes(s.status)).length;

  const handleSyncFromDoc = async () => {
    setSyncing(true);
    try {
      // Trigger a no-op save with the current document to re-sync headings
      // The backend auto-syncs sections whenever editor-document is saved.
      // Here we just re-fetch sections to reflect any pending sync.
      await onRefresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Info banner: sections auto-sync from document headings */}
      <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-xs text-indigo-700">
        <svg className="w-4 h-4 mt-0.5 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
        </svg>
        <span>
          Sections are <strong>automatically synced</strong> from the H2 headings in your grant document whenever you save.
          Use the <button onClick={onOpenEditor} className="underline hover:no-underline font-medium">Grant Editor</button> to add or rename sections.
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Proposal Sections</h2>
          <p className="text-xs text-gray-500 mt-0.5">{completeCount} of {sections.length} sections complete</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSyncFromDoc}
            disabled={syncing}
            className="text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
          >
            {syncing ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button
            onClick={onOpenEditor}
            className="text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50"
          >
            Open Editor
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + Section
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-3">
          <input
            required
            placeholder="Section title"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.section_type}
              onChange={(e) => setForm((f) => ({ ...f, section_type: e.target.value }))}
            >
              {SECTION_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Word limit"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.word_limit}
              onChange={(e) => setForm((f) => ({ ...f, word_limit: e.target.value }))}
            />
          </div>
          <input
            type="date"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.due_date}
            onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          />
          <textarea
            rows={2}
            placeholder="Funder requirement text (optional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            value={form.requirement_text}
            onChange={(e) => setForm((f) => ({ ...f, requirement_text: e.target.value }))}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-gray-500">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {sections.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No sections tracked yet. Add sections to track proposal writing progress.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Section</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Type</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Words</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Due</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Doc</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sections.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="py-2 px-3">
                    <span className="font-medium text-gray-800">{s.title}</span>
                    {s.requirement_text && (
                      <p className="text-xs text-gray-400 truncate max-w-xs">{s.requirement_text}</p>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">{s.section_type.replace(/_/g, ' ')}</td>
                  <td className="py-2 px-3">
                    <select
                      value={s.status}
                      onChange={(e) => handleStatusChange(s, e.target.value)}
                      className={`text-xs px-2 py-0.5 rounded-full border-0 ${getStatusStyle(SECTION_STATUSES, s.status)}`}
                    >
                      {SECTION_STATUSES.map((st) => (
                        <option key={st.value} value={st.value}>{st.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {s.current_word_count > 0 && (
                      <span>{s.current_word_count}{s.word_limit ? `/${s.word_limit}` : ''}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-400">{s.due_date ?? '—'}</td>
                  <td className="py-2 px-3">
                    {s.linked_document_url ? (
                      <a href={s.linked_document_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">
                        Open
                      </a>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1">
                      <button onClick={onOpenEditor} className="text-xs text-indigo-500 hover:text-indigo-700 px-1">Write</button>
                      <button onClick={() => handleDelete(s)} className="text-xs text-red-400 hover:text-red-600 px-1">×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
