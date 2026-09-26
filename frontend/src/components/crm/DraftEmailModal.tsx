'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import CrmModal, { fieldStyle, errDetail } from './CrmModal';
import { btnPrimary, btnQuiet } from './crmUi';

/**
 * Compose an email to a partner and hand it to the user's mail app to send.
 * "To" is pre-filled with their address; the AI can write a first draft.
 */
export default function DraftEmailModal({
  partner, onClose,
}: { partner: { id: string; name: string; email?: string | null }; onClose: () => void }) {
  const [to, setTo] = useState(partner.email || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [purpose, setPurpose] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aiDraft() {
    if (!purpose.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await partnersApi.draftOutreach(partner.id, { purpose: purpose.trim() });
      setSubject(res.data?.subject || subject);
      setBody(res.data?.body || body);
    } catch (err) {
      setError(errDetail(err, 'Couldn’t write a draft — write it yourself or try again.'));
    } finally { setDrafting(false); }
  }

  function send() {
    const params = new URLSearchParams();
    if (subject.trim()) params.set('subject', subject.trim());
    if (body.trim()) params.set('body', body);
    // URLSearchParams encodes spaces as "+", which mail apps show literally.
    const query = params.toString().replace(/\+/g, '%20');
    window.location.href = `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@').replace(/%2C/g, ',')}${query ? `?${query}` : ''}`;
    onClose();
  }

  return (
    <CrmModal
      title={`Email ${partner.name}`}
      subtitle="Opens in your email app, ready to send."
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          {error && <p className="text-xs flex-1" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="text-sm px-4 h-9" style={btnQuiet}>Cancel</button>
            <button type="button" onClick={send} disabled={!to.trim()} className="text-sm px-4 h-9 font-medium disabled:opacity-40" style={btnPrimary}>
              Open in email
            </button>
          </div>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="mail-to">To</label>
          <input id="mail-to" type="email" value={to} onChange={e => setTo(e.target.value)} autoFocus={!partner.email}
            placeholder="No email on file — type one" className="w-full px-3 h-9 text-sm mono-data" style={fieldStyle} />
        </div>

        <div className="p-3 rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)' }}>
          <label className="flex items-center gap-1.5 text-xs font-medium mb-2" htmlFor="mail-purpose" style={{ color: 'var(--ink-secondary)' }}>
            <Sparkles className="w-3.5 h-3.5" />Write it for me (optional)
          </label>
          <div className="flex gap-2">
            <input id="mail-purpose" value={purpose} onChange={e => setPurpose(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aiDraft(); }}
              placeholder="What’s it about? e.g. invite them to co-lead the ultrasound work package"
              className="flex-1 px-3 h-9 text-sm" style={{ ...fieldStyle, background: 'var(--surface-base)' }} />
            <button type="button" onClick={aiDraft} disabled={drafting || !purpose.trim()} className="h-9 px-3 text-[13px] font-medium disabled:opacity-40" style={btnQuiet}>
              {drafting ? 'Writing…' : 'Draft'}
            </button>
          </div>
        </div>

        <div>
          <label className="ledger-label block mb-1.5" htmlFor="mail-subject">Subject</label>
          <input id="mail-subject" value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-3 h-9 text-sm" style={fieldStyle} />
        </div>
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="mail-body">Message</label>
          <textarea id="mail-body" rows={9} value={body} onChange={e => setBody(e.target.value)} autoFocus={!!partner.email}
            placeholder={`Hi ${partner.name.split(' ')[0]},`} className="w-full px-3 py-2 text-sm resize-y" style={fieldStyle} />
        </div>
      </div>
    </CrmModal>
  );
}
