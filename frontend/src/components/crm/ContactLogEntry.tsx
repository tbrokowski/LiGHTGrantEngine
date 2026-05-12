'use client';

const UPDATE_ICONS: Record<string, string> = {
  email: '📧',
  call: '📞',
  meeting: '🤝',
  note: '📝',
  other: '💬',
};

const UPDATE_COLORS: Record<string, string> = {
  email: 'border-blue-200 bg-blue-50',
  call: 'border-green-200 bg-green-50',
  meeting: 'border-purple-200 bg-purple-50',
  note: 'border-gray-200 bg-gray-50',
  other: 'border-slate-200 bg-slate-50',
};

interface ContactLogEntryProps {
  update: {
    id: string;
    content: string;
    update_type: string;
    contact_date?: string | null;
    next_contact_date?: string | null;
    created_at?: string | null;
    user_id?: string;
  };
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function isOverdue(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

export default function ContactLogEntry({ update }: ContactLogEntryProps) {
  const icon = UPDATE_ICONS[update.update_type] ?? UPDATE_ICONS.other;
  const colorClass = UPDATE_COLORS[update.update_type] ?? UPDATE_COLORS.other;

  return (
    <div className={`rounded-lg border p-4 ${colorClass}`}>
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {update.update_type}
            </span>
            <span className="text-xs text-gray-400 shrink-0">
              {formatDate(update.contact_date || update.created_at)}
            </span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{update.content}</p>
          {update.next_contact_date && (
            <div className={`mt-2 text-xs font-medium flex items-center gap-1 ${
              isOverdue(update.next_contact_date) ? 'text-red-600' : 'text-blue-600'
            }`}>
              <span>📅</span>
              <span>
                {isOverdue(update.next_contact_date) ? 'Overdue — ' : 'Follow up: '}
                {formatDate(update.next_contact_date)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
