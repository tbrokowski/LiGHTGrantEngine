'use client';
import { useState } from 'react';
import { partnerGroups } from '@/lib/api';
import CrmModal, { fieldStyle, errDetail } from './CrmModal';
import { Avatar, Segmented, btnPrimary, btnQuiet } from './crmUi';

type Kind = 'meeting' | 'call' | 'email';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Log a meeting (or call/email) with a group; it counts as contact for each attendee. */
export default function LogMeetingModal({
  group, members, onClose, onLogged,
}: {
  group: { id: string; name: string; color?: string | null };
  members: { id: string; name: string; organization?: string | null }[];
  onClose: () => void;
  onLogged: () => void;
}) {
  const [kind, setKind] = useState<Kind>('meeting');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [attending, setAttending] = useState<Set<string>>(new Set(members.map(m => m.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = attending.size === members.length;

  async function save() {
    if (!attending.size) return;
    setBusy(true);
    setError(null);
    try {
      // Midday local time so the date doesn't shift across time zones.
      await partnerGroups.logInteraction(group.id, {
        kind, title: title.trim() || undefined, notes: notes.trim() || undefined,
        date: new Date(`${date}T12:00:00`).toISOString(), partner_ids: Array.from(attending),
      });
      onLogged();
      onClose();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t log that.'));
    } finally { setBusy(false); }
  }

  const noun = kind === 'meeting' ? 'meeting' : kind === 'call' ? 'call' : 'email';
  return (
    <CrmModal
      title={`Log a ${noun} with ${group.name}`}
      subtitle="Counts as contact for everyone who attended."
      accent={group.color}
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          <p className="text-xs flex-1" style={{ color: error ? 'var(--state-danger)' : 'var(--ink-muted)' }}>
            {error || `${attending.size} of ${members.length} attending`}
          </p>
          <button type="button" onClick={onClose} className="text-sm px-4 h-9" style={btnQuiet}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !attending.size} className="text-sm px-4 h-9 font-medium disabled:opacity-40" style={btnPrimary}>
            {busy ? 'Saving…' : `Log ${noun}`}
          </button>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Segmented label="Type" value={kind} onChange={setKind}
            options={[{ value: 'meeting', label: 'Meeting' }, { value: 'call', label: 'Call' }, { value: 'email', label: 'Email' }]} />
          <input type="date" aria-label="Date" value={date} max={today()} onChange={e => setDate(e.target.value)}
            className="h-8 px-2.5 text-sm" style={fieldStyle} />
        </div>
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="log-title">What was it</label>
          <input id="log-title" autoFocus value={title} onChange={e => setTitle(e.target.value)}
            placeholder={kind === 'meeting' ? 'e.g. Monthly site sync' : kind === 'call' ? 'e.g. Budget check-in' : 'e.g. Sent draft work plan'}
            className="w-full px-3 h-9 text-sm" style={fieldStyle} />
        </div>
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="log-notes">Notes</label>
          <textarea id="log-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Decisions, action items, anything to remember" className="w-full px-3 py-2 text-sm resize-none" style={fieldStyle} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="ledger-label">Attended</span>
            <button type="button" onClick={() => setAttending(all ? new Set() : new Set(members.map(m => m.id)))}
              className="text-xs underline" style={{ color: 'var(--ink-secondary)' }}>
              {all ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto" style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)' }}>
            {members.map(m => (
              <label key={m.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                <input type="checkbox" checked={attending.has(m.id)} onChange={() => setAttending(prev => {
                  const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n;
                })} />
                <Avatar name={m.name} size={24} />
                <span className="text-sm flex-1 truncate" style={{ color: 'var(--ink-primary)' }}>{m.name}</span>
                <span className="text-xs truncate max-w-[200px]" style={{ color: 'var(--ink-muted)' }}>{m.organization || ''}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </CrmModal>
  );
}
