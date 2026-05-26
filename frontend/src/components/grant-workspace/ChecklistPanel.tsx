'use client';

import { useState } from 'react';
import { ChecklistItem } from './types';
import { grants } from '@/lib/api';

interface Props {
  grantId: string;
  items: ChecklistItem[];
  onRefresh: () => void;
}

const CATEGORIES = [
  'narrative', 'budget', 'letters', 'cvs', 'institutional_approvals',
  'ethics', 'data_management', 'formatting', 'submission_portal',
  'partner_materials', 'compliance', 'signatures', 'general',
];

const STATUS_COLORS: Record<string, string> = {
  not_started: 'text-gray-400',
  in_progress: 'text-blue-500',
  complete: 'text-green-600',
  not_applicable: 'text-gray-300',
  blocked: 'text-red-500',
};

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function ChecklistPanel({ grantId, items, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'general', required: true, due_date: '' });
  const [saving, setSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await grants.generateChecklist(grantId);
      onRefresh();
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await grants.createChecklistItem(grantId, { ...form, due_date: form.due_date || null, display_order: items.length });
      setForm({ title: '', category: 'general', required: true, due_date: '' });
      setShowForm(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleStatusToggle = async (item: ChecklistItem) => {
    const nextStatus = item.status === 'complete' ? 'not_started' : 'complete';
    await grants.updateChecklistItem(grantId, item.id, { status: nextStatus });
    onRefresh();
  };

  const handleDelete = async (item: ChecklistItem) => {
    if (!confirm(`Remove "${item.title}"?`)) return;
    await grants.deleteChecklistItem(grantId, item.id);
    onRefresh();
  };

  const grouped = CATEGORIES.reduce<Record<string, ChecklistItem[]>>((acc, cat) => {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length > 0) acc[cat] = catItems;
    return acc;
  }, {});

  const required = items.filter((i) => i.required);
  const complete = required.filter((i) => i.status === 'complete');
  const pct = required.length > 0 ? Math.round((complete.length / required.length) * 100) : 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Submission Checklist</h2>
          <p className="text-xs text-gray-500 mt-0.5">{complete.length}/{required.length} required items complete</p>
        </div>
        <div className="flex gap-2">
          {items.length === 0 && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate Default'}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + Add Item
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Progress</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Category filter */}
      {Object.keys(grouped).length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={`text-xs px-2.5 py-1 rounded-full border ${activeCategory === null ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}
          >
            All
          </button>
          {Object.keys(grouped).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`text-xs px-2.5 py-1 rounded-full border ${activeCategory === cat ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}
            >
              {cat.replace(/_/g, ' ')} ({grouped[cat].length})
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-3">
          <input
            required
            placeholder="Item title"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <input
              type="date"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.due_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} />
            Required
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-gray-500">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No checklist items. Generate a default checklist or add items manually.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped)
            .filter(([cat]) => !activeCategory || cat === activeCategory)
            .map(([cat, catItems]) => (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                  {cat.replace(/_/g, ' ')} ({catItems.filter((i) => i.status === 'complete').length}/{catItems.length})
                </h3>
                <div className="space-y-1">
                  {catItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 group"
                    >
                      <button
                        onClick={() => handleStatusToggle(item)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          item.status === 'complete'
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-300 hover:border-green-400'
                        }`}
                      >
                        {item.status === 'complete' && <CheckIcon />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${item.status === 'complete' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {item.title}
                        </span>
                        {!item.required && (
                          <span className="ml-2 text-xs text-gray-400">(optional)</span>
                        )}
                        {item.due_date && (
                          <span className="ml-2 text-xs text-gray-400">{item.due_date}</span>
                        )}
                      </div>
                      {item.linked_document_url && (
                        <a href={item.linked_document_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline shrink-0">
                          Doc
                        </a>
                      )}
                      <button
                        onClick={() => handleDelete(item)}
                        className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
