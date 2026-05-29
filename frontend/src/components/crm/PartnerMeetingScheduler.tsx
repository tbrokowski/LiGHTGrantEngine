'use client';
import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface PartnerMeetingSchedulerProps {
  partnerId: string;
  partnerName: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function PartnerMeetingScheduler({ partnerId, partnerName, onClose, onCreated }: PartnerMeetingSchedulerProps) {
  const [title, setTitle] = useState(`Meeting with ${partnerName}`);
  const [scheduledAt, setScheduledAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState('');
  const [meetingType, setMeetingType] = useState('video');
  const [agenda, setAgenda] = useState<string[]>(['']);
  const [reminderAt, setReminderAt] = useState('');
  const [saving, setSaving] = useState(false);

  function addAgendaItem() {
    setAgenda([...agenda, '']);
  }

  function removeAgendaItem(i: number) {
    setAgenda(agenda.filter((_, idx) => idx !== i));
  }

  function updateAgendaItem(i: number, val: string) {
    setAgenda(agenda.map((item, idx) => idx === i ? val : item));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await partnersApi.createMeeting(partnerId, {
        title,
        scheduled_at: scheduledAt || null,
        duration_minutes: duration,
        location: location || null,
        meeting_type: meetingType,
        agenda: agenda.filter(a => a.trim()),
        reminder_at: reminderAt || null,
      });
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Schedule Meeting</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Meeting title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date & time</label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Duration (minutes)</label>
              <input type="number" value={duration} onChange={e => setDuration(parseInt(e.target.value))} min={5} step={15}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
              <select value={meetingType} onChange={e => setMeetingType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="video">Video call</option>
                <option value="in_person">In person</option>
                <option value="phone">Phone</option>
                <option value="conference">Conference</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Location / Link</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Zoom link, room, etc."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Agenda */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Agenda items</label>
              <button type="button" onClick={addAgendaItem}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Plus className="w-3 h-3" />Add item
              </button>
            </div>
            <div className="space-y-1.5">
              {agenda.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                  <input value={item} onChange={e => updateAgendaItem(i, e.target.value)}
                    placeholder={`Agenda item ${i + 1}`}
                    className="flex-1 border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {agenda.length > 1 && (
                    <button type="button" onClick={() => removeAgendaItem(i)}
                      className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reminder */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reminder (optional)</label>
            <input type="datetime-local" value={reminderAt} onChange={e => setReminderAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="flex-1 text-sm py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 text-sm py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
              {saving ? 'Scheduling…' : 'Schedule Meeting'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
