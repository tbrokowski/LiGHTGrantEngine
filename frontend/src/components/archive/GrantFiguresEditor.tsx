'use client';
/**
 * Edit an archived grant's money and the team's odds at submission in one
 * small form. Used from the Archive list and the archive detail page; the
 * Insights Data tab edits the same fields cell by cell.
 */
import { useState } from 'react';
import { CONFIDENCE_PRESETS, normalizeCurrency, parseAmount } from '@/lib/archiveStats';
import { inputStyle } from './insights/ui';

export interface GrantFigures {
  requested_amount: number | null;
  awarded_amount: number | null;
  currency: string | null;
  win_confidence: number | null;
}

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'SGD', 'JPY', 'SEK', 'NOK', 'DKK', 'ZAR', 'KES', 'INR'];

export default function GrantFiguresEditor({
  initial, onSave, onClose, showConfidence = true,
}: {
  initial: GrantFigures;
  onSave: (patch: Partial<GrantFigures>) => Promise<void>;
  onClose: () => void;
  showConfidence?: boolean;
}) {
  const [requested, setRequested] = useState(initial.requested_amount != null ? String(initial.requested_amount) : '');
  const [awarded, setAwarded] = useState(initial.awarded_amount != null ? String(initial.awarded_amount) : '');
  const [currency, setCurrency] = useState(normalizeCurrency(initial.currency) ?? 'USD');
  const [confidence, setConfidence] = useState(initial.win_confidence != null ? String(initial.win_confidence) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const req = parseAmount(requested);
    const aw = parseAmount(awarded);
    if (req != null && (Number.isNaN(req) || req < 0)) return setError('Requested: enter an amount like 250k or 1.2M');
    if (aw != null && (Number.isNaN(aw) || aw < 0)) return setError('Awarded: enter an amount like 250k or 1.2M');
    const cur = normalizeCurrency(currency);
    if (cur && !/^[A-Z]{3}$/.test(cur)) return setError('Currency: use a 3-letter code like EUR');
    const confText = confidence.trim().replace(/%$/, '');
    const conf = confText === '' ? null : Number(confText);
    if (conf != null && (!Number.isInteger(conf) || conf < 0 || conf > 100)) return setError('Odds: a whole number from 0 to 100');

    const patch: Partial<GrantFigures> = {};
    if (req !== initial.requested_amount) patch.requested_amount = req;
    if (aw !== initial.awarded_amount) patch.awarded_amount = aw;
    if ((cur ?? null) !== (normalizeCurrency(initial.currency) ?? null)) patch.currency = cur;
    if (showConfidence && conf !== initial.win_confidence) patch.win_confidence = conf;
    if (!Object.keys(patch).length) return onClose();

    setSaving(true);
    setError('');
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      const d = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(typeof d === 'string' ? d : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const field = 'w-full px-2 py-1.5 text-xs mono-data tabular-nums';
  return (
    <form
      className="p-3 space-y-3 text-left"
      onSubmit={e => { e.preventDefault(); save(); }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="grid grid-cols-[1fr_84px] gap-2">
        <label className="block">
          <span className="ledger-label block">Requested</span>
          <input autoFocus value={requested} onChange={e => { setRequested(e.target.value); setError(''); }}
            placeholder="e.g. 1.2M" className={`${field} mt-1`} style={inputStyle} />
        </label>
        <label className="block">
          <span className="ledger-label block">Currency</span>
          <input value={currency} onChange={e => { setCurrency(e.target.value); setError(''); }} list="grant-figures-currencies"
            className={`${field} mt-1 uppercase`} style={inputStyle} />
          <datalist id="grant-figures-currencies">{COMMON_CURRENCIES.map(c => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <label className="block">
        <span className="ledger-label block">Awarded</span>
        <input value={awarded} onChange={e => { setAwarded(e.target.value); setError(''); }}
          placeholder="leave blank if not funded" className={`${field} mt-1`} style={inputStyle} />
      </label>

      {showConfidence && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="ledger-label">Our odds at submission</span>
            {confidence !== '' && (
              <button type="button" onClick={() => setConfidence('')} className="text-[10.5px] hover:underline" style={{ color: 'var(--ink-muted)' }}>
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {CONFIDENCE_PRESETS.map(p => {
              const on = confidence === String(p.value);
              return (
                <button key={p.value} type="button" onClick={() => { setConfidence(String(p.value)); setError(''); }}
                  className="px-1.5 py-0.5 text-[10.5px]"
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${on ? 'var(--accent-primary)' : 'var(--rule-subtle)'}`,
                    background: on ? 'var(--accent-primary)' : 'transparent',
                    color: on ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
                  }}>
                  {p.label} <span className="mono-data">{p.value}%</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <input value={confidence} onChange={e => { setConfidence(e.target.value); setError(''); }} inputMode="numeric"
              placeholder="unrated" className={`${field} w-20 text-right`} style={inputStyle} aria-label="Odds in percent" />
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>%</span>
          </div>
          <p className="text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--ink-muted)' }}>
            How likely you thought a win was. Long shots then count less in the confidence-adjusted win rate.
          </p>
        </div>
      )}

      {error && <p className="text-[11px]" style={{ color: 'var(--state-danger)' }}>{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-2.5 py-1 text-xs" style={{ color: 'var(--ink-muted)' }}>Cancel</button>
        <button type="submit" disabled={saving} className="px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
