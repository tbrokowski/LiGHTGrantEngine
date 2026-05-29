'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckSquare, Square, Sparkles, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { partners as partnersApi } from '@/lib/api';

interface ActionItem {
  text: string;
  assignee_name?: string;
  due_date?: string;
  done: boolean;
}

interface Meeting {
  id: string;
  title: string;
  scheduled_at?: string;
  duration_minutes: number;
  location?: string;
  meeting_type: string;
  agenda: string[];
  notes?: string;
  action_items: ActionItem[];
  attendees: { name: string; email?: string; is_internal?: boolean }[];
  grant_context_entity_type?: string;
  grant_context_entity_id?: string;
  meeting_prep?: string;
  meeting_prep_generated_at?: string;
  completed_at?: string;
  created_at?: string;
}

interface PartnerMeetingCardProps {
  partnerId: string;
  meeting: Meeting;
  onRefresh: () => void;
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  video: '📹 Video call',
  in_person: '🤝 In person',
  phone: '📞 Phone',
  conference: '🎤 Conference',
};

function formatDateTime(d?: string | null) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
}

export default function PartnerMeetingCard({ partnerId, meeting, onRefresh }: PartnerMeetingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const [generatingPrep, setGeneratingPrep] = useState(false);
  const [prepGenerated, setPrepGenerated] = useState(false);
  const [actionItems, setActionItems] = useState<ActionItem[]>(meeting.action_items || []);

  const isUpcoming = meeting.scheduled_at && !meeting.completed_at && new Date(meeting.scheduled_at) >= new Date();
  const isPast = meeting.completed_at || (meeting.scheduled_at && new Date(meeting.scheduled_at) < new Date());

  async function handleGeneratePrep() {
    setGeneratingPrep(true);
    try {
      await partnersApi.generateMeetingPrep(partnerId, meeting.id);
      setPrepGenerated(true);
      setTimeout(onRefresh, 3000);
    } finally { setGeneratingPrep(false); }
  }

  async function toggleActionItem(idx: number) {
    const updated = actionItems.map((item, i) => i === idx ? { ...item, done: !item.done } : item);
    setActionItems(updated);
    await partnersApi.updateMeeting(partnerId, meeting.id, { action_items: updated });
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${
      meeting.completed_at ? 'border-gray-200 bg-gray-50/50' :
      isUpcoming ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white'
    }`}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs text-gray-500">{MEETING_TYPE_LABELS[meeting.meeting_type] || meeting.meeting_type}</span>
              {isUpcoming && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Upcoming</span>}
              {meeting.completed_at && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Complete</span>}
              {meeting.meeting_prep && !showPrep && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI Prep Ready</span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900">{meeting.title}</h3>
            {meeting.scheduled_at && (
              <div className="text-xs text-gray-500 mt-0.5">{formatDateTime(meeting.scheduled_at)} · {meeting.duration_minutes}min</div>
            )}
            {meeting.location && <div className="text-xs text-gray-400 mt-0.5">📍 {meeting.location}</div>}
          </div>
          <div className="flex items-center gap-1">
            {!meeting.meeting_prep && !meeting.completed_at && (
              <button onClick={handleGeneratePrep} disabled={generatingPrep}
                className="flex items-center gap-1 text-xs text-purple-600 border border-purple-200 px-2.5 py-1 rounded-lg hover:bg-purple-50 disabled:opacity-50">
                <Sparkles className="w-3 h-3" />
                {generatingPrep ? 'Generating…' : prepGenerated ? 'Queued' : 'AI Prep'}
              </button>
            )}
            <button onClick={() => setExpanded(!expanded)}
              className="p-1 text-gray-400 hover:text-gray-600">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Quick action items summary when collapsed */}
        {!expanded && actionItems.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            {actionItems.filter(a => a.done).length}/{actionItems.length} action items done
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-200 px-4 py-4 space-y-4">
          {/* Agenda */}
          {meeting.agenda.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Agenda</h4>
              <ul className="space-y-1">
                {meeting.agenda.map((item, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-gray-400 text-xs mt-0.5">{i + 1}.</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes */}
          {meeting.notes && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{meeting.notes}</p>
            </div>
          )}

          {/* Action items */}
          {actionItems.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Action Items</h4>
              <div className="space-y-1.5">
                {actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 cursor-pointer" onClick={() => toggleActionItem(i)}>
                    {item.done
                      ? <CheckSquare className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      : <Square className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    }
                    <span className={`text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {item.text}
                      {item.assignee_name && <span className="text-xs text-gray-400 ml-1">({item.assignee_name})</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attendees */}
          {meeting.attendees.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Attendees</h4>
              <div className="flex flex-wrap gap-2">
                {meeting.attendees.map((a, i) => (
                  <span key={i} className={`text-xs px-2 py-1 rounded-full ${a.is_internal ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {a.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Meeting Prep */}
          {meeting.meeting_prep && (
            <div>
              <button
                onClick={() => setShowPrep(!showPrep)}
                className="flex items-center gap-2 text-xs font-semibold text-purple-700 mb-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Meeting Briefing
                {showPrep ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showPrep && (
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 text-sm">
                  <div className="prose prose-sm max-w-none text-gray-700 [&_h2]:text-sm [&_h3]:text-xs [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-purple-700 [&_ul]:space-y-1">
                    <ReactMarkdown>{meeting.meeting_prep}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
