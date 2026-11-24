'use client';
// Log outreach (an email, call or meeting) with a funder from the Funders tab,
// and optionally set a follow-up (a task on them, assigned to you). Without a
// fixed person, the user picks one of `choices`.
import { useState } from 'react';
import { partners as partnersApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import CrmModal, { fieldStyle, errDetail } from '@/components/crm/CrmModal';
import { Segmented, btnPrimary, btnQuiet } from '@/components/crm/crmUi';

type Kind = 'email' | 'call' | 'meeting' | 'other';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

type Person = { id: string; name: string };

export default function LogTouchModal({
  partner: fixed, choices = [], onClose, onLogged,
}: { partner?: Person; choices?: Person[]; onClose: () => void; onLogged: () => void }) {
  const { user } = useAuth();
  const [pickedId, setPickedId] = useState('');
  const partner: Person | undefined = fixed ?? choices.find(c => c.id === pickedId);
  const [kind, setKind] = useState<Kind>('email');
  const [date, setDate] = useState(today());
  const [content, setContent] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = partner?.name.split(/\s+/)[0] ?? 'them';

  async function save() {
    if (!partner) { setError('Pick who you reached out to.'); return; }
    setBusy(true);
    setError(null);
    try {
      const followIso = followUp ? new Date(`${followUp}T12:00:00`).toISOString() : undefined;
      await partnersApi.addUpdate(partner.id, {
        update_type: kind,
        content: content.trim() || `${kind === 'other' ? 'Outreach' : kind[0].toUpperCase() + kind.slice(1)} with ${partner.name}`,
        contact_date: new Date(`${date}T12:00:00`).toISOString(),
        next_contact_date: followIso,
      });
      if (followIso) {
        await partnersApi.createTask(partner.id, {
          title: `Follow up with ${partner.name}`,
          due_date: followIso,
          assigned_to: user?.id,
        });
      }
      onLogged();
      onClose();
    } catch (e) {
      setError(errDetail(e, 'Could not log this outreach.'));
      setBusy(false);
    }
  }

  return (
    <CrmModal
      title={fixed ? `Log outreach with ${fixed.name}` : 'Log outreach'}
      subtitle="Counts toward relationship health on the Funders and Partners tabs."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 text-[13px]" style={btnQuiet}>Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="h-8 px-3 text-[13px] font-medium disabled:opacity-50" style={btnPrimary}>
            {busy ? 'Saving…' : 'Log it'}
          </button>
        </div>
      }
    >
      <div className="px-6 py-5 flex flex-col gap-4">
        {!fixed && (
          <label className="flex flex-col gap-1.5">
            <span className="ledger-label">Who</span>
            <select value={pickedId} onChange={e => { setPickedId(e.target.value); setError(null); }} autoFocus
              className="h-9 px-2 text-[13px]" style={fieldStyle}>
              <option value="">Pick a funder…</option>
              {[...choices].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Segmented label="Kind of outreach" value={kind} onChange={setKind}
            options={[{ value: 'email', label: 'Email' }, { value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' }, { value: 'other', label: 'Other' }]} />
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            When
            <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className="h-8 px-2 text-[13px]" style={fieldStyle} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">What happened</span>
          <textarea rows={4} value={content} onChange={e => setContent(e.target.value)} autoFocus={!!fixed}
            placeholder={`e.g. Intro call with ${first} — interested in the maternal health program; wants a one-pager.`}
            className="px-3 py-2 text-[13px] resize-none" style={fieldStyle} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="ledger-label">Follow up</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[{ l: 'None', v: '' }, { l: '1 week', v: inDays(7) }, { l: '2 weeks', v: inDays(14) }, { l: '1 month', v: inDays(30) }].map(o => (
              <button key={o.l} type="button" onClick={() => setFollowUp(o.v)} aria-pressed={followUp === o.v}
                className="h-7 px-2.5 text-xs rounded-full"
                style={{
                  border: `1px solid ${followUp === o.v ? 'var(--ink-secondary)' : 'var(--rule-subtle)'}`,
                  background: followUp === o.v ? 'var(--surface-sunken)' : 'var(--surface-base)',
                  color: followUp === o.v ? 'var(--ink-primary)' : 'var(--ink-muted)',
                }}>
                {o.l}
              </button>
            ))}
            <input type="date" aria-label="Follow-up date" value={followUp} min={today()} onChange={e => setFollowUp(e.target.value)}
              className="h-7 px-2 text-xs" style={fieldStyle} />
          </div>
          {followUp && (
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Adds a task “Follow up with {partner?.name ?? 'them'}”, assigned to you.
            </p>
          )}
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--state-danger)' }}>{error}</p>}
      </div>
    </CrmModal>
  );
}
