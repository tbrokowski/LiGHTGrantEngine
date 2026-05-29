'use client';
import { useState } from 'react';
import { MessageSquare, Phone, Mail, Users, FileText, Link, ChevronDown } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  note: { icon: <FileText className="w-3.5 h-3.5" />, color: 'text-gray-600', bg: 'bg-gray-100' },
  email: { icon: <Mail className="w-3.5 h-3.5" />, color: 'text-blue-600', bg: 'bg-blue-50' },
  call: { icon: <Phone className="w-3.5 h-3.5" />, color: 'text-green-600', bg: 'bg-green-50' },
  meeting: { icon: <Users className="w-3.5 h-3.5" />, color: 'text-purple-600', bg: 'bg-purple-50' },
  other: { icon: <MessageSquare className="w-3.5 h-3.5" />, color: 'text-gray-500', bg: 'bg-gray-100' },
};

interface Update {
  id: string;
  content: string;
  update_type: string;
  contact_date?: string;
  next_contact_date?: string;
  created_at?: string;
}

interface PartnerTimelineProps {
  partnerId: string;
  updates: Update[];
  onRefresh: () => void;
}

function formatDate(d?: string | null) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function formatDateTime(d?: string | null) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
}

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

export default function PartnerTimeline({ partnerId, updates, onRefresh }: PartnerTimelineProps) {
  const [showForm, setShowForm] = useState(false);
  const [content, setContent] = useState('');
  const [type, setType] = useState('note');
  const [contactDate, setContactDate] = useState('');
  const [nextContact, setNextContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? updates : updates.filter(u => u.update_type === filter);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await partnersApi.addUpdate(partnerId, {
        content,
        update_type: type,
        contact_date: contactDate || null,
        next_contact_date: nextContact || null,
      });
      setContent(''); setType('note'); setContactDate(''); setNextContact('');
      setShowForm(false);
      onRefresh();
    } finally { setSaving(false); }
  }

  return (
    <div>
      {/* Quick log bar */}
      {!showForm ? (
        <div
          onClick={() => setShowForm(true)}
          className="mb-4 p-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400 cursor-pointer hover:border-gray-400 hover:text-gray-600 transition-colors"
        >
          + Add a note, log a call, email or meeting…
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {['note', 'email', 'call', 'meeting', 'other'].map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">When</label>
              <input type="datetime-local" value={contactDate} onChange={e => setContactDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Follow-up</label>
              <input type="datetime-local" value={nextContact} onChange={e => setNextContact(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} required rows={3} autoFocus
            className="w-full border border-gray-300 rounded-md px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Notes, summary, outcomes…" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-100 text-gray-600">Cancel</button>
            <button type="submit" disabled={saving}
              className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* Filter tabs */}
      {updates.length > 0 && (
        <div className="flex gap-1 mb-4 overflow-x-auto">
          {['all', 'note', 'email', 'call', 'meeting'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                filter === f ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Timeline entries */}
      {filtered.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-10">No interactions logged yet.</div>
      ) : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-200" />
          <div className="space-y-4">
            {filtered.map(u => {
              const cfg = TYPE_CONFIG[u.update_type] || TYPE_CONFIG.other;
              return (
                <div key={u.id} className="flex gap-3 pl-0">
                  <div className={`relative z-10 w-10 h-10 shrink-0 rounded-full ${cfg.bg} flex items-center justify-center ${cfg.color} border-2 border-white shadow-sm`}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 bg-white border border-gray-100 rounded-lg p-3.5 shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{u.update_type}</span>
                      <span className="text-xs text-gray-400">{formatDateTime(u.contact_date || u.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{u.content}</p>
                    {u.next_contact_date && (
                      <div className={`mt-2 text-xs font-medium flex items-center gap-1 ${isOverdue(u.next_contact_date) ? 'text-red-600' : 'text-blue-600'}`}>
                        {isOverdue(u.next_contact_date) ? '⚠ Overdue follow-up: ' : '📅 Follow-up: '}
                        {formatDate(u.next_contact_date)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
