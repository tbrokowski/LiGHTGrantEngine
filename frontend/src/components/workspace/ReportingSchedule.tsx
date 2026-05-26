'use client';
import { useState, useEffect, useCallback } from 'react';
import { grants } from '@/lib/api';

interface ReportingDeadline {
  id: string;
  title: string;
  date: string;
  status: 'pending' | 'submitted' | 'overdue';
  notes?: string;
}

interface Props {
  grantId: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  submitted: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
};

function formatDate(d: string) {
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function daysUntil(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export default function ReportingSchedule({ grantId }: Props) {
  const [deadlines, setDeadlines] = useState<ReportingDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newDeadline, setNewDeadline] = useState({ title: '', date: '', notes: '' });

  const fetchDeadlines = useCallback(() => {
    grants.get(grantId)
      .then(r => {
        const raw = r.data?.reporting_deadlines;
        setDeadlines(Array.isArray(raw) ? raw : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { fetchDeadlines(); }, [fetchDeadlines]);

  async function saveDeadlines(updated: ReportingDeadline[]) {
    setSaving(true);
    try {
      await grants.updateReporting(grantId, updated);
      setDeadlines(updated);
    } catch {
      alert('Failed to save reporting schedule.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    if (!newDeadline.title.trim() || !newDeadline.date) return;
    const newItem: ReportingDeadline = {
      id: Date.now().toString(),
      title: newDeadline.title.trim(),
      date: newDeadline.date,
      status: 'pending',
      notes: newDeadline.notes,
    };
    await saveDeadlines([...deadlines, newItem]);
    setNewDeadline({ title: '', date: '', notes: '' });
    setAdding(false);
  }

  async function toggleStatus(id: string) {
    const updated = deadlines.map(d => {
      if (d.id !== id) return d;
      const next: Record<string, ReportingDeadline['status']> = {
        pending: 'submitted',
        submitted: 'pending',
        overdue: 'submitted',
      };
      return { ...d, status: next[d.status] ?? 'pending' };
    });
    await saveDeadlines(updated);
  }

  async function handleDelete(id: string) {
    await saveDeadlines(deadlines.filter(d => d.id !== id));
  }

  const sorted = [...deadlines].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Reporting Schedule</h3>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Reporting Schedule</h3>
          <p className="text-xs text-gray-400 mt-0.5">Track when progress reports are due to the funder.</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(v => !v)}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add deadline
        </button>
      </div>

      {adding && (
        <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Report title</label>
              <input
                type="text"
                value={newDeadline.title}
                onChange={e => setNewDeadline(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Mid-term report"
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Due date</label>
              <input
                type="date"
                value={newDeadline.date}
                onChange={e => setNewDeadline(p => ({ ...p, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newDeadline.title.trim() || !newDeadline.date || saving}
              className="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400">
          No reporting deadlines set. Add them to track when reports are due.
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(d => {
            const days = daysUntil(d.date);
            const isOverdue = days < 0 && d.status !== 'submitted';
            const status = isOverdue ? 'overdue' : d.status;

            return (
              <div key={d.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3">
                <button
                  onClick={() => toggleStatus(d.id)}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    status === 'submitted'
                      ? 'bg-emerald-500 border-emerald-500'
                      : isOverdue
                      ? 'border-red-400'
                      : 'border-gray-300 hover:border-gray-500'
                  }`}
                >
                  {status === 'submitted' && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${status === 'submitted' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {d.title}
                  </p>
                  <p className={`text-xs mt-0.5 ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                    {formatDate(d.date)}
                    {isOverdue ? ` · ${Math.abs(days)}d overdue` : days > 0 && days <= 30 ? ` · ${days}d left` : ''}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status]}`}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
                <button
                  onClick={() => handleDelete(d.id)}
                  className="text-gray-200 hover:text-gray-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
