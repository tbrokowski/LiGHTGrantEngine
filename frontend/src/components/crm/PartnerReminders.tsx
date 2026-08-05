'use client';
import { useEffect, useState, useCallback } from 'react';
import { Bell, Plus, Trash2, Check } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface Reminder {
  id: string;
  title: string;
  description?: string | null;
  scheduled_for?: string | null;
  sent_at?: string | null;
}

function fmt(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

/** Reach-out reminders for a partner — replaces the old follow-up/status flow.
 *  A reminder fires an in-app notification on its date (server-side worker). */
export default function PartnerReminders({ partnerId }: { partnerId: string }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await partnersApi.listReminders(partnerId);
      setReminders(res.data);
    } finally { setLoading(false); }
  }, [partnerId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!date) return;
    setSaving(true);
    try {
      // Fire mid-morning local time on the chosen day.
      const scheduled = new Date(`${date}T09:00:00`).toISOString();
      await partnersApi.addReminder(partnerId, {
        scheduled_for: scheduled,
        title: note.trim() || 'Reach out',
        description: note.trim() || undefined,
      });
      setDate(''); setNote(''); setAdding(false);
      load();
    } finally { setSaving(false); }
  }

  async function handleDelete(reminderId: string) {
    await partnersApi.deleteReminder(partnerId, reminderId);
    setReminders(rs => rs.filter(r => r.id !== reminderId));
  }

  const now = new Date();

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5" />Reach-out reminders
        </h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            <Plus className="w-3.5 h-3.5" />Set reminder
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Remind me on</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              min={now.toISOString().slice(0, 10)}
              className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Note (optional)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Follow up on the LOI"
              className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setDate(''); setNote(''); }}
              className="text-xs px-2.5 py-1 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-100">Cancel</button>
            <button onClick={handleAdd} disabled={!date || saving}
              className="text-xs px-3 py-1 bg-blue-600 text-white rounded-md disabled:opacity-40 hover:bg-blue-700">
              {saving ? 'Saving…' : 'Set reminder'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : reminders.length === 0 ? (
        !adding && <p className="text-xs text-gray-400">No reminders set.</p>
      ) : (
        <div className="space-y-1.5">
          {reminders.map(r => {
            const overdue = r.scheduled_for && new Date(r.scheduled_for) < now && !r.sent_at;
            return (
              <div key={r.id} className="flex items-start justify-between gap-2 text-xs group">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {r.sent_at ? (
                      <Check className="w-3 h-3 text-green-600 shrink-0" />
                    ) : (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${overdue ? 'bg-red-500' : 'bg-blue-500'}`} />
                    )}
                    <span className={`font-medium ${overdue ? 'text-red-600' : 'text-gray-700'}`}>{fmt(r.scheduled_for)}</span>
                  </div>
                  {r.description && <p className="text-gray-500 ml-4 truncate">{r.description}</p>}
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity shrink-0"
                  title="Remove reminder"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
