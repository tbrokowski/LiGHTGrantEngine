'use client';
import { useRef, useState } from 'react';
import { partnerGroups } from '@/lib/api';
import CrmModal, { fieldStyle, errDetail } from './CrmModal';
import { GROUP_COLORS, GROUP_ICONS, GroupBadge, Segmented, btnPrimary, btnQuiet } from './crmUi';

type Look = 'initials' | 'icon' | 'logo';
const LOGO_PX = 128;

/** Shrink an uploaded image to a LOGO_PX square (contained, not cropped) and
 *  return it as a data URL — PNG keeps transparency, and at this size it's a
 *  few KB. */
function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(LOGO_PX / img.width, LOGO_PX / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = LOGO_PX;
      canvas.height = LOGO_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas')); return; }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (LOGO_PX - w) / 2, (LOGO_PX - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image')); };
    img.src = url;
  });
}

/**
 * Create a group (optionally seeded with `partnerIds`, e.g. from a bulk
 * selection) or edit an existing one's name, description, color and look.
 */
export default function GroupFormModal({
  group, partnerIds = [], onClose, onSaved,
}: {
  group?: { id: string; name: string; description?: string | null; color?: string | null; icon?: string | null; logo?: string | null };
  partnerIds?: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [color, setColor] = useState<string | null>(group?.color ?? null);
  const [look, setLook] = useState<Look>(group?.logo ? 'logo' : group?.icon ? 'icon' : 'initials');
  const [icon, setIcon] = useState<string | null>(group?.icon ?? null);
  const [logo, setLogo] = useState<string | null>(group?.logo ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setError('Use a PNG, JPEG, WebP or GIF image.');
      return;
    }
    try {
      setLogo(await resizeLogo(file));
      setError(null);
    } catch {
      setError('Couldn’t read that image.');
    }
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    // Only the chosen look is kept; the others are cleared ("" clears on update).
    const lookFields = {
      icon: look === 'icon' && icon ? icon : '',
      logo: look === 'logo' && logo ? logo : '',
    };
    try {
      if (group) {
        await partnerGroups.update(group.id, {
          name: name.trim(), description: description.trim(), ...(color ? { color } : {}), ...lookFields,
        });
        onSaved(group.id);
      } else {
        const res = await partnerGroups.create({
          name: name.trim(), description: description.trim() || undefined,
          ...(color ? { color } : {}),
          ...(lookFields.icon ? { icon: lookFields.icon } : {}),
          ...(lookFields.logo ? { logo: lookFields.logo } : {}),
          partner_ids: partnerIds,
        });
        onSaved(res.data.id);
      }
      onClose();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t save the group.'));
    } finally { setBusy(false); }
  }

  const preview = {
    name: name.trim() || 'New group',
    color: color || group?.color || GROUP_COLORS[0],
    icon: look === 'icon' ? icon : null,
    logo: look === 'logo' ? logo : null,
  };

  return (
    <CrmModal
      title={group ? 'Edit group' : 'New group'}
      subtitle={!group && partnerIds.length ? `With the ${partnerIds.length} selected ${partnerIds.length === 1 ? 'person' : 'people'}` : !group ? 'You can add people by tag right after.' : undefined}
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
        <div className="flex items-start gap-3">
          <GroupBadge group={preview} size={48} />
          <div className="flex-1">
            <label className="ledger-label block mb-1.5" htmlFor="group-name">Name</label>
            <input id="group-name" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }}
              placeholder="e.g. Wits · Johannesburg site" className="w-full px-3 h-9 text-sm" style={fieldStyle} />
          </div>
        </div>
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="group-desc">What it’s for</label>
          <textarea id="group-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="The site, work package or project this group represents" className="w-full px-3 py-2 text-sm resize-none" style={fieldStyle} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="ledger-label">Look</span>
            <Segmented label="Group look" value={look} onChange={setLook}
              options={[{ value: 'initials', label: 'Initials' }, { value: 'icon', label: 'Icon' }, { value: 'logo', label: 'Logo' }]} />
          </div>

          {look === 'icon' && (
            <div className="grid grid-cols-7 gap-1.5 p-2 rounded-[var(--radius-md)]" role="radiogroup" aria-label="Icon" style={{ background: 'var(--surface-sunken)' }}>
              {(Object.keys(GROUP_ICONS) as (keyof typeof GROUP_ICONS)[]).map(key => {
                const Icon = GROUP_ICONS[key];
                const on = icon === key;
                return (
                  <button key={key} type="button" role="radio" aria-checked={on} aria-label={key} title={key} onClick={() => setIcon(key)}
                    className="h-10 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors"
                    style={{
                      background: on ? preview.color : 'var(--surface-base)',
                      color: on ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
                      border: `1px solid ${on ? preview.color : 'var(--rule-subtle)'}`,
                    }}>
                    <Icon className="w-[18px] h-[18px]" />
                  </button>
                );
              })}
            </div>
          )}

          {look === 'logo' && (
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)' }}>
              {logo
                ? <GroupBadge group={{ ...preview, logo }} size={56} />
                : <div className="w-14 h-14 rounded-[var(--radius-md)] flex items-center justify-center text-[11px] text-center" style={{ border: '1px dashed var(--rule-strong)', color: 'var(--ink-muted)' }}>No logo</div>}
              <div className="flex-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                PNG, JPEG, WebP or GIF. It’s resized to {LOGO_PX}px — a square logo on a transparent or white background looks best.
              </div>
              <div className="flex flex-col gap-1.5">
                <button type="button" onClick={() => fileRef.current?.click()} className="h-8 px-3 text-xs font-medium" style={btnQuiet}>
                  {logo ? 'Replace' : 'Upload'}
                </button>
                {logo && <button type="button" onClick={() => setLogo(null)} className="text-xs underline" style={{ color: 'var(--ink-muted)' }}>Remove</button>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pickLogo} />
            </div>
          )}
        </div>

        {(
          <div>
            <span className="ledger-label block mb-1.5">Color{look === 'logo' && <span className="normal-case tracking-normal font-normal"> — used for charts and chips</span>}</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Group color">
              {GROUP_COLORS.map(c => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center"
                  style={{ background: c, outline: color === c ? '2px solid var(--ink-primary)' : 'none', outlineOffset: 2 }} />
              ))}
            </div>
            {!color && !group && <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>Leave unset to pick the next color automatically.</p>}
          </div>
        )}
      </div>
    </CrmModal>
  );
}
