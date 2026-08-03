'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { feedback as feedbackApi } from '@/lib/api';

interface FeedbackItem {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  category: string;
  message: string;
  page_url: string | null;
  status: string;
  created_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug', concern: 'Concern', idea: 'Idea', revision: 'Revision', other: 'Comment',
};

const CATEGORY_COLORS: Record<string, string> = {
  bug: 'bg-red-50 text-red-700 border-red-200',
  concern: 'bg-amber-50 text-amber-700 border-amber-200',
  idea: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  revision: 'bg-purple-50 text-purple-700 border-purple-200',
  other: 'bg-gray-100 text-gray-600 border-gray-200',
};

// status value → display label + chip style
const STATUSES: { value: string; label: string; chip: string }[] = [
  { value: 'new', label: 'Unreviewed', chip: 'bg-gray-100 text-gray-600' },
  { value: 'in_progress', label: 'In progress', chip: 'bg-amber-50 text-amber-700' },
  { value: 'resolved', label: 'Done', chip: 'bg-green-50 text-green-700' },
];

function statusInfo(v: string) {
  return STATUSES.find(s => s.value === v) ?? STATUSES[0];
}

function fmtDate(d: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return d; }
}

export function FeedbackPanel() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await feedbackApi.list();
      setItems(res.data);
    } catch { setItems([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, new: 0, in_progress: 0, resolved: 0 };
    items.forEach(i => { c[i.status] = (c[i.status] ?? 0) + 1; });
    return c;
  }, [items]);

  const visible = filter === 'all' ? items : items.filter(i => i.status === filter);

  async function setStatus(id: string, status: string) {
    setSaving(id);
    try {
      await feedbackApi.updateStatus(id, status);
      setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    } catch {
      alert('Failed to update status.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Feedback</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Comments, concerns, bugs and revision requests submitted from the app. Click a card to review it and set its status.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {[{ value: 'all', label: 'All' }, ...STATUSES].map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === f.value ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label} ({counts[f.value] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-400">No feedback in this view.</p>
      ) : (
        <div className="space-y-2">
          {visible.map(item => {
            const isOpen = expanded === item.id;
            const si = statusInfo(item.status);
            return (
              <div key={item.id} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Card header (click to expand) */}
                <button
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.other}`}>
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm text-gray-800 ${isOpen ? '' : 'truncate'}`}>{item.message}</span>
                    <span className="block text-xs text-gray-400 mt-0.5 truncate">
                      {(item.user_name || item.user_email || 'Unknown')} · {fmtDate(item.created_at)}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${si.chip}`}>{si.label}</span>
                </button>

                {/* Expanded review + status controls */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50/40">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{item.message}</p>
                    <div className="text-xs text-gray-500 space-y-0.5 mb-3">
                      <p><span className="text-gray-400">From:</span> {(item.user_name || '—')} {item.user_email && <span className="text-gray-400">&lt;{item.user_email}&gt;</span>}</p>
                      {item.page_url && <p><span className="text-gray-400">Page:</span> {item.page_url}</p>}
                      <p><span className="text-gray-400">Submitted:</span> {fmtDate(item.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 mr-1">Mark as:</span>
                      {STATUSES.map(s => (
                        <button
                          key={s.value}
                          onClick={() => setStatus(item.id, s.value)}
                          disabled={saving === item.id}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                            item.status === s.value
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'border-gray-200 text-gray-600 hover:bg-white'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
