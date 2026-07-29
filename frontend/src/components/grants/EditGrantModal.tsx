'use client';
import { useEffect, useRef, useState } from 'react';
import { grants } from '@/lib/api';
import type { GrantSummary } from './ProposalCard';

interface Props {
  grant: GrantSummary;
  onClose: () => void;
  onSaved: (id: string, patch: Partial<GrantSummary>) => void;
}

/** Edit a grant's name, due date, and award/funded amount. */
export default function EditGrantModal({ grant, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(grant.title ?? '');
  const [deadline, setDeadline] = useState((grant.external_deadline ?? '').slice(0, 10));
  const [award, setAward] = useState(grant.award_amount != null ? String(grant.award_amount) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function save() {
    if (!title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    const awardNum = award.trim() ? Number(award.replace(/[, ]/g, '')) : null;
    const patch: Record<string, unknown> = {
      title: title.trim(),
      external_deadline: deadline || null,
      award_amount: awardNum,
    };
    try {
      await grants.update(grant.id, patch);
      onSaved(grant.id, {
        title: title.trim(),
        external_deadline: deadline || null,
        award_amount: awardNum,
      });
      onClose();
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-sunken)',
    color: 'var(--ink-primary)',
    outline: 'none',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--surface-overlay)' }} onMouseDown={onClose}>
      <div
        className="w-full max-w-sm mx-4 p-5"
        style={{ background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-primary)' }}>Edit grant</h2>
        {error && <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{ color: 'var(--state-danger)', background: 'var(--state-danger-bg)' }}>{error}</p>}

        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Name</label>
        <input ref={firstRef} value={title} onChange={e => setTitle(e.target.value)}
          className="w-full px-3 py-2 text-sm mb-3" style={inputStyle}
          onKeyDown={e => { if (e.key === 'Enter') save(); }} />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Due date</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full px-2 py-2 text-sm" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Award / funded</label>
            <input inputMode="numeric" value={award} onChange={e => setAward(e.target.value)} placeholder="0" className="w-full px-2 py-2 text-sm" style={inputStyle}
              onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm" style={{ color: 'var(--ink-muted)' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="px-3.5 py-1.5 text-sm font-medium rounded disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: '#fff', borderRadius: 'var(--radius-sm)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
