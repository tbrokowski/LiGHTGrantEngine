'use client';
/**
 * Spreadsheet-style editor for the numbers behind the statistics. Click a cell
 * to edit; Enter saves and moves down, Tab moves right, Escape cancels. Missing
 * values the statistics need are flagged so they can be filled in place.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FxSettings, type GapKey, type InsightEntry, type InsightTag,
  DEFAULT_USD_RATES, GAPS, OUTCOME_OPTIONS, formatMoney, gapsOf, normalizeCurrency, outcomeLabel, parseAmount,
} from '@/lib/archiveStats';
import TagPicker from './TagPicker';
import { Menu, Segmented, TagDot, inputStyle } from './ui';

export type EntryPatch = Partial<Pick<InsightEntry,
  'funder' | 'call_year' | 'outcome' | 'currency' | 'requested_amount' | 'awarded_amount' | 'submission_date' | 'decision_date'>>;

type ColKey = 'funder' | 'call_year' | 'outcome' | 'currency' | 'requested_amount' | 'awarded_amount' | 'submission_date' | 'decision_date';

const COLS: { key: ColKey; label: string; gap?: GapKey; width: number; align?: 'right' }[] = [
  { key: 'funder', label: 'Funder', gap: 'funder', width: 160 },
  { key: 'call_year', label: 'Year', gap: 'year', width: 70, align: 'right' },
  { key: 'outcome', label: 'Outcome', gap: 'outcome', width: 128 },
  { key: 'currency', label: 'Cur.', gap: 'currency', width: 64 },
  { key: 'requested_amount', label: 'Requested', gap: 'requested', width: 116, align: 'right' },
  { key: 'awarded_amount', label: 'Awarded', gap: 'awarded', width: 116, align: 'right' },
  { key: 'submission_date', label: 'Submitted', gap: 'submission_date', width: 116 },
  { key: 'decision_date', label: 'Decided', gap: 'decision_date', width: 116 },
];

export default function DataPanel({
  entries, selected, tags, fx, canEdit, gap, onGap, scope, onScope,
  onUpdate, onToggleSelected, onToggleTag, onCreateTag,
}: {
  entries: InsightEntry[];
  selected: Set<string>;
  tags: InsightTag[];
  fx: FxSettings;
  canEdit: boolean;
  gap: GapKey | null;
  onGap: (g: GapKey | null) => void;
  scope: 'selected' | 'all';
  onScope: (s: 'selected' | 'all') => void;
  onUpdate: (id: string, patch: EntryPatch) => Promise<void>;
  onToggleSelected: (id: string) => void;
  onToggleTag: (tag: InsightTag, add: boolean, ids: string[]) => Promise<void>;
  onCreateTag: (name: string, group: string, ids: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ id: string; col: ColKey } | null>(null);
  const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);

  const inScope = useMemo(() => (scope === 'all' ? entries : entries.filter(e => selected.has(e.id))), [entries, selected, scope]);
  const gapsById = useMemo(() => new Map(inScope.map(e => [e.id, new Set(gapsOf(e))])), [inScope]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(GAPS.map(g => [g.key, 0])) as Record<GapKey, number>;
    for (const s of gapsById.values()) for (const g of s) c[g]++;
    return c;
  }, [gapsById]);
  // Keep a row on screen while it's being edited, even once its gap is filled.
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => { setPinned(new Set()); }, [gap, scope]);
  const rows = useMemo(
    () => inScope.filter(e => !gap || gapsById.get(e.id)?.has(gap) || pinned.has(e.id)),
    [inScope, gap, gapsById, pinned],
  );
  const currencies = useMemo(() => {
    const seen = new Set<string>([fx.base, ...Object.keys(fx.usd), ...Object.keys(DEFAULT_USD_RATES)]);
    for (const e of entries) { const c = normalizeCurrency(e.currency); if (c) seen.add(c); }
    return [...seen].sort();
  }, [entries, fx]);

  const totalGaps = rows.reduce((n, e) => n + (gapsById.get(e.id)?.size ?? 0), 0);

  function move(from: { id: string; col: ColKey }, dir: 'down' | 'right' | 'left') {
    const r = rows.findIndex(e => e.id === from.id);
    const c = COLS.findIndex(x => x.key === from.col);
    if (dir === 'down') {
      const next = rows[r + 1];
      setEditing(next ? { id: next.id, col: from.col } : null);
    } else {
      const nc = c + (dir === 'right' ? 1 : -1);
      if (nc >= 0 && nc < COLS.length) setEditing({ id: from.id, col: COLS[nc].key });
      else setEditing(null);
    }
  }

  async function commit(e: InsightEntry, col: ColKey, patch: EntryPatch) {
    if (gap) setPinned(p => new Set(p).add(e.id));
    await onUpdate(e.id, patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Segmented value={scope} onChange={onScope} size="sm" ariaLabel="Rows" options={[
          { value: 'selected', label: `Selected (${selected.size})` },
          { value: 'all', label: `All grants (${entries.length})` },
        ]} />
        <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {canEdit ? 'Click a cell to edit — changes save immediately and update every chart.' : 'Read-only — grant leads and org admins can edit.'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="ledger-label mr-1">Missing</span>
        <GapChip active={!gap} onClick={() => onGap(null)} label="Show all" />
        {GAPS.map(g => counts[g.key] > 0 && (
          <GapChip key={g.key} active={gap === g.key} onClick={() => onGap(gap === g.key ? null : g.key)} label={g.label} count={counts[g.key]} title={g.hint} />
        ))}
        {GAPS.every(g => !counts[g.key]) && (
          <span className="text-[11px]" style={{ color: 'var(--state-success)' }}>Nothing missing — every grant here is complete.</span>
        )}
      </div>

      <div className="overflow-x-auto" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
        <table className="text-xs" style={{ minWidth: 1180, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
              <th className="px-2 py-2 text-left ledger-label sticky left-0 z-[1]" style={{ minWidth: 260, background: 'var(--surface-sunken)', boxShadow: 'inset -1px 0 0 var(--rule-subtle)' }}>
                <span title="Checked grants are included in the statistics">Grant</span>
              </th>
              {COLS.map(c => (
                <th key={c.key} className={`px-2 py-2 ledger-label ${c.align === 'right' ? 'text-right' : 'text-left'}`} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2 text-left ledger-label" style={{ minWidth: 150 }}>Tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={COLS.length + 2} className="px-3 py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
                {gap ? 'Nothing missing here.' : scope === 'selected' ? 'No grants selected.' : 'The archive is empty.'}
              </td></tr>
            )}
            {rows.map(e => {
              const gaps = gapsById.get(e.id) ?? new Set<GapKey>();
              const on = selected.has(e.id);
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                  <td className="px-2 py-1.5 max-w-[300px] sticky left-0 z-[1]" style={{ background: 'var(--surface-base)', boxShadow: 'inset -1px 0 0 var(--rule-subtle)' }}>
                    <span className="flex items-center gap-2 min-w-0">
                      <input type="checkbox" checked={on} onChange={() => onToggleSelected(e.id)} aria-label={`Include ${e.title} in the analysis`} className="accent-[#18181B] shrink-0" />
                      <Link href={`/archive/${e.id}`} className="block truncate font-medium hover:underline" style={{ color: on ? 'var(--ink-primary)' : 'var(--ink-muted)' }} title={e.title}>
                        {e.title}
                      </Link>
                    </span>
                  </td>
                  {COLS.map(c => (
                    <Cell
                      key={c.key}
                      entry={e}
                      col={c.key}
                      align={c.align}
                      missing={!!c.gap && gaps.has(c.gap)}
                      emphasize={!!c.gap && c.gap === gap}
                      canEdit={canEdit}
                      fx={fx}
                      currencies={currencies}
                      editing={editing?.id === e.id && editing.col === c.key}
                      onStart={() => canEdit && setEditing({ id: e.id, col: c.key })}
                      onCancel={() => setEditing(null)}
                      onCommit={async (patch, nav) => {
                        if (patch) await commit(e, c.key, patch);
                        if (nav) move({ id: e.id, col: c.key }, nav); else setEditing(null);
                      }}
                    />
                  ))}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      {e.tag_ids.map(id => tagById.get(id)).filter(Boolean).map(t => (
                        <span key={t!.id} className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--ink-secondary)' }}>
                          <TagDot color={t!.color} size={6} />{t!.name}
                        </span>
                      ))}
                      {canEdit && (
                        <Menu align="right" width={260} button={(_o, toggle) => (
                          <button type="button" onClick={toggle} className="px-1.5 text-[11px] leading-5"
                            style={{ color: 'var(--ink-muted)', border: '1px dashed var(--rule-strong)', borderRadius: 999 }}
                            aria-label={`Edit tags for ${e.title}`}>
                            {e.tag_ids.length ? '±' : '+ tag'}
                          </button>
                        )}>
                          <TagPicker
                            tags={tags}
                            targets={[e]}
                            canEdit={canEdit}
                            onToggle={(t, add) => onToggleTag(t, add, [e.id])}
                            onCreate={(name, group) => onCreateTag(name, group, [e.id])}
                          />
                        </Menu>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <p className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
          {rows.length} grant{rows.length === 1 ? '' : 's'} · {totalGaps} missing value{totalGaps === 1 ? '' : 's'}.
          Amounts accept 250k, 1.2M, or 1,200,000 and are stored in the grant’s own currency.
        </p>
      )}
    </div>
  );
}

function GapChip({ active, onClick, label, count, title }: { active: boolean; onClick: () => void; label: string; count?: number; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium"
      style={{
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--rule-subtle)'}`,
        background: active ? 'var(--accent-primary)' : 'transparent',
        color: active ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
      }}
    >
      {label}
      {count != null && (
        <span className="mono-data text-[10px] px-1 rounded-full" style={{
          background: active ? 'rgba(255,255,255,0.2)' : 'var(--state-warning-bg)',
          color: active ? 'var(--ink-inverse)' : 'var(--state-warning)',
        }}>{count}</span>
      )}
    </button>
  );
}

function display(e: InsightEntry, col: ColKey, fx: FxSettings): string | null {
  switch (col) {
    case 'funder': return e.funder?.trim() || null;
    case 'call_year': return e.call_year ? String(e.call_year) : null;
    case 'outcome': return e.outcome ? outcomeLabel(e.outcome) : null;
    case 'currency': return normalizeCurrency(e.currency);
    case 'requested_amount':
    case 'awarded_amount': {
      const v = e[col];
      return v == null ? null : formatMoney(v, normalizeCurrency(e.currency) ?? fx.base, false);
    }
    case 'submission_date':
    case 'decision_date': return e[col] ? e[col]!.slice(0, 10) : null;
  }
}

function rawValue(e: InsightEntry, col: ColKey): string {
  const v = e[col];
  if (v == null) return '';
  if (col === 'requested_amount' || col === 'awarded_amount') return String(v);
  if (col === 'currency') return normalizeCurrency(v as string) ?? '';
  if (col === 'submission_date' || col === 'decision_date') return String(v).slice(0, 10);
  return String(v);
}

/** Turn the typed text into a patch; a string is a validation error. */
function toPatch(col: ColKey, text: string, e: InsightEntry): EntryPatch | null | string {
  const t = text.trim();
  if (t === rawValue(e, col)) return null;
  switch (col) {
    case 'funder': return { funder: t || null };
    case 'call_year': {
      if (!t) return { call_year: null };
      const y = Number(t);
      if (!Number.isInteger(y) || y < 1950 || y > 2100) return 'Enter a year like 2024';
      return { call_year: y };
    }
    case 'outcome': return { outcome: t || null };
    case 'currency': {
      if (!t) return { currency: null };
      const c = normalizeCurrency(t)!;
      if (!/^[A-Z]{3}$/.test(c)) return 'Use a 3-letter code like EUR';
      return { currency: c };
    }
    case 'requested_amount':
    case 'awarded_amount': {
      const v = parseAmount(t);
      if (v != null && (Number.isNaN(v) || v < 0)) return 'Enter an amount like 250k or 1.2M';
      return { [col]: v } as EntryPatch;
    }
    case 'submission_date':
    case 'decision_date': {
      if (!t) return { [col]: null } as EntryPatch;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'Use a date';
      return { [col]: t } as EntryPatch;
    }
  }
}

/** Mounted only while a cell is being edited, so it starts with the cell's
 *  value and focus immediately. */
function CellEditor({
  entry, col, align, currencies, onCancel, onCommit,
}: {
  entry: InsightEntry;
  col: ColKey;
  align?: 'right';
  currencies: string[];
  onCancel: () => void;
  onCommit: (patch: EntryPatch | null, nav?: 'down' | 'right' | 'left') => Promise<void>;
}) {
  const [text, setText] = useState(() => rawValue(entry, col));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const done = useRef(false);

  async function finish(nav?: 'down' | 'right' | 'left', value = text) {
    if (done.current) return;
    const patch = toPatch(col, value, entry);
    if (typeof patch === 'string') { setError(patch); return; }
    done.current = true;
    setSaving(true);
    try { await onCommit(patch, nav); } catch { done.current = false; } finally { setSaving(false); }
  }

  const common = {
    autoFocus: true,
    className: 'w-full px-1.5 py-1 text-xs',
    style: {
      ...inputStyle,
      opacity: saving ? 0.6 : 1,
      background: 'var(--surface-raised)',
      borderColor: error ? 'var(--state-danger)' : 'var(--accent-primary)',
      textAlign: align === 'right' ? 'right' as const : 'left' as const,
    },
    'aria-label': COLS.find(c => c.key === col)?.label,
    'aria-invalid': !!error,
    title: error || undefined,
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish('down'); }
      else if (ev.key === 'Tab') { ev.preventDefault(); finish(ev.shiftKey ? 'left' : 'right'); }
      else if (ev.key === 'Escape') { ev.preventDefault(); done.current = true; onCancel(); }
    },
  };

  return (
    <>
      {col === 'outcome' ? (
        <select {...common} value={text}
          onChange={ev => { setText(ev.target.value); finish(undefined, ev.target.value); }}
          onBlur={() => finish()}>
          <option value="">—</option>
          {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <>
          <input {...common}
            type={col === 'submission_date' || col === 'decision_date' ? 'date' : 'text'}
            inputMode={col === 'call_year' ? 'numeric' : undefined}
            list={col === 'currency' ? 'insight-currencies' : undefined}
            placeholder={col.endsWith('amount') ? 'e.g. 250k' : undefined}
            value={text}
            onFocus={ev => { if (ev.currentTarget.type === 'text') ev.currentTarget.select(); }}
            onChange={ev => { setText(ev.target.value); setError(''); }}
            onBlur={() => finish()} />
          {col === 'currency' && <datalist id="insight-currencies">{currencies.map(c => <option key={c} value={c} />)}</datalist>}
        </>
      )}
      {error && <div className="text-[10px] mt-0.5" style={{ color: 'var(--state-danger)' }}>{error}</div>}
    </>
  );
}

function Cell({
  entry, col, align, missing, emphasize, canEdit, fx, currencies, editing, onStart, onCancel, onCommit,
}: {
  entry: InsightEntry;
  col: ColKey;
  align?: 'right';
  missing: boolean;
  emphasize: boolean;
  canEdit: boolean;
  fx: FxSettings;
  currencies: string[];
  editing: boolean;
  onStart: () => void;
  onCancel: () => void;
  onCommit: (patch: EntryPatch | null, nav?: 'down' | 'right' | 'left') => Promise<void>;
}) {
  const shown = display(entry, col, fx);
  const tdClass = `px-2 py-1.5 ${align === 'right' ? 'text-right' : 'text-left'}`;

  if (editing) {
    return (
      <td className={tdClass}>
        <CellEditor entry={entry} col={col} align={align} currencies={currencies} onCancel={onCancel} onCommit={onCommit} />
      </td>
    );
  }

  return (
    <td
      className={`${tdClass} ${canEdit ? 'cursor-text' : ''}`}
      onClick={onStart}
      style={{ background: emphasize && missing ? 'var(--state-warning-bg)' : undefined }}
    >
      {shown != null ? (
        <span className={`${col.endsWith('amount') || col === 'call_year' || col.endsWith('date') ? 'mono-data tabular-nums' : ''} truncate block`}
          style={{ color: 'var(--ink-secondary)' }} title={shown}>
          {shown}
        </span>
      ) : missing ? (
        canEdit ? (
          <span className="inline-block px-1.5 text-[10.5px] font-medium" style={{ color: 'var(--state-warning)', border: '1px dashed var(--state-warning)', borderRadius: 999 }}>
            + Add
          </span>
        ) : <span style={{ color: 'var(--state-warning)' }}>missing</span>
      ) : (
        <span style={{ color: 'var(--ink-faint)' }}>—</span>
      )}
    </td>
  );
}
