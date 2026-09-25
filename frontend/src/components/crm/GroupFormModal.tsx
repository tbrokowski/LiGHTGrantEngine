'use client';
import { useState } from 'react';
import { partnerGroups } from '@/lib/api';
import CrmModal, { fieldStyle, errDetail } from './CrmModal';
import { GROUP_COLORS, btnPrimary, btnQuiet } from './crmUi';

/**
 * Create a group (optionally seeded with `partnerIds`, e.g. from a bulk
 * selection) or edit an existing one's name, description and color.
 */
export default function GroupFormModal({
  group, partnerIds = [], onClose, onSaved,
}: {
  group?: { id: string; name: string; description?: string | null; color?: string | null };
  partnerIds?: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [color, setColor] = useState<string | null>(group?.color ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (group) {
        await partnerGroups.update(group.id, { name: name.trim(), description: description.trim(), ...(color ? { color } : {}) });
        onSaved(group.id);
      } else {
        const res = await partnerGroups.create({
          name: name.trim(), description: description.trim() || undefined,
          ...(color ? { color } : {}), partner_ids: partnerIds,
        });
        onSaved(res.data.id);
      }
      onClose();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t save the group.'));
    } finally { setBusy(false); }
  }

  return (
    <CrmModal
      title={group ? 'Edit group' : 'New group'}
      subtitle={!group && partnerIds.length ? `With the ${partnerIds.length} selected ${partnerIds.length === 1 ? 'person' : 'people'}` : !group ? 'You can add people by tag right after.' : undefined}
      accent={color}
      onClose={onClose}
      footer={
        <>
          {error && <p className="text-xs flex-1" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="text-sm px-4 h-9" style={btnQuiet}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || !name.trim()} className="text-sm px-4 h-9 font-medium disabled:opacity-40" style={btnPrimary}>
              {busy ? 'Saving…' : group ? 'Save' : 'Create group'}
            </button>
          </div>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="group-name">Name</label>
          <input id="group-name" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }}
            placeholder="e.g. Wits · Johannesburg site" className="w-full px-3 h-9 text-sm" style={fieldStyle} />
        </div>
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="group-desc">What it’s for</label>
          <textarea id="group-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="The site, work package or project this group represents" className="w-full px-3 py-2 text-sm resize-none" style={fieldStyle} />
        </div>
        <div>
          <span className="ledger-label block mb-1.5">Color</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Group color">
            {GROUP_COLORS.map(c => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
                className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center"
                style={{ background: c, outline: color === c ? '2px solid var(--ink-primary)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
          {!color && !group && <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>Leave unset to pick the next color automatically.</p>}
        </div>
      </div>
    </CrmModal>
  );
}
