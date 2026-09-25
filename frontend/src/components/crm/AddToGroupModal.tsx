'use client';
import { useEffect, useState } from 'react';
import { partnerGroups } from '@/lib/api';
import CrmModal, { errDetail } from './CrmModal';
import { GroupRef, btnPrimary, btnQuiet } from './crmUi';

/** Put the selected people into an existing group, or start a new one with them. */
export default function AddToGroupModal({
  partnerIds, onClose, onDone, onNewGroup,
}: { partnerIds: string[]; onClose: () => void; onDone: () => void; onNewGroup: () => void }) {
  const [groups, setGroups] = useState<(GroupRef & { member_count: number })[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { partnerGroups.list().then(r => setGroups(r.data || [])).catch(() => {}); }, []);

  async function add() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await partnerGroups.addMembers(picked, { partner_ids: partnerIds });
      onDone();
      onClose();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t add them to that group.'));
    } finally { setBusy(false); }
  }

  const n = partnerIds.length;
  return (
    <CrmModal
      title={`Add ${n} ${n === 1 ? 'person' : 'people'} to a group`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          {error && <p className="text-xs flex-1" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="text-sm px-4 h-9" style={btnQuiet}>Cancel</button>
            <button type="button" onClick={add} disabled={busy || !picked} className="text-sm px-4 h-9 font-medium disabled:opacity-40" style={btnPrimary}>
              {busy ? 'Adding…' : 'Add to group'}
            </button>
          </div>
        </>
      }
    >
      <div role="radiogroup" aria-label="Group">
        {groups.map(g => (
          <label key={g.id} className="flex items-center gap-3 px-6 py-2.5 cursor-pointer" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            <input type="radio" name="group" checked={picked === g.id} onChange={() => setPicked(g.id)} />
            <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color || 'var(--ink-muted)' }} />
            <span className="flex-1 text-sm" style={{ color: 'var(--ink-primary)' }}>{g.name}</span>
            <span className="mono-data text-xs" style={{ color: 'var(--ink-muted)' }}>{g.member_count}</span>
          </label>
        ))}
        <button type="button" onClick={() => { onClose(); onNewGroup(); }}
          className="w-full text-left px-6 py-3 text-sm font-medium" style={{ color: 'var(--ink-secondary)' }}>
          + New group with {n === 1 ? 'this person' : 'these people'}…
        </button>
      </div>
    </CrmModal>
  );
}
