'use client';
import { useState } from 'react';
import { FileText, Mail, Phone, Users, CheckSquare, ChevronDown } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

type ActivityType = 'note' | 'email' | 'call' | 'meeting' | 'task';

const TYPES: { id: ActivityType; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'note', label: 'Note', icon: <FileText className="w-3.5 h-3.5" />, color: 'text-gray-600' },
  { id: 'email', label: 'Email', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-blue-600' },
  { id: 'call', label: 'Call', icon: <Phone className="w-3.5 h-3.5" />, color: 'text-green-600' },
  { id: 'meeting', label: 'Meeting', icon: <Users className="w-3.5 h-3.5" />, color: 'text-purple-600' },
  { id: 'task', label: 'Task', icon: <CheckSquare className="w-3.5 h-3.5" />, color: 'text-orange-600' },
];

interface ActivityComposerProps {
  partnerId: string;
  onActivityLogged: () => void;
  onMeetingClick?: () => void;
  onTaskClick?: () => void;
}

export default function ActivityComposer({
  partnerId, onActivityLogged, onMeetingClick, onTaskClick,
}: ActivityComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeType, setActiveType] = useState<ActivityType>('note');
  const [content, setContent] = useState('');
  const [contactDate, setContactDate] = useState('');
  const [nextContact, setNextContact] = useState('');
  const [saving, setSaving] = useState(false);

  function handleTypeClick(type: ActivityType) {
    if (type === 'meeting') { onMeetingClick?.(); return; }
    if (type === 'task') { onTaskClick?.(); return; }
    setActiveType(type);
    setExpanded(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await partnersApi.addUpdate(partnerId, {
        content,
        update_type: activeType,
        contact_date: contactDate || null,
        next_contact_date: nextContact || null,
      });
      setContent(''); setContactDate(''); setNextContact('');
      setExpanded(false);
      onActivityLogged();
    } finally { setSaving(false); }
  }

  const currentType = TYPES.find(t => t.id === activeType)!;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
      {/* Type selector strip */}
      <div className="flex border-b border-gray-100">
        {TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => handleTypeClick(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              activeType === t.id && expanded
                ? `${t.color} bg-gray-50 border-b-2 border-current`
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Collapsed state — single click-to-expand bar */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-left px-4 py-3 text-sm text-gray-400 hover:text-gray-600 flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <span className={currentType.color}>{currentType.icon}</span>
            Log a {currentType.label.toLowerCase()}…
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-300" />
        </button>
      )}

      {/* Expanded form */}
      {expanded && (
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">When</label>
              <input type="datetime-local" value={contactDate} onChange={e => setContactDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Follow-up date</label>
              <input type="datetime-local" value={nextContact} onChange={e => setNextContact(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            required
            rows={3}
            autoFocus
            className="w-full border border-gray-300 rounded-md px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder={`${currentType.label} notes…`}
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setExpanded(false)}
              className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-100 text-gray-600">
              Cancel
            </button>
            <button type="submit" disabled={saving || !content.trim()}
              className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
              {saving ? 'Saving…' : `Log ${currentType.label}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
