'use client';
import { useMemo, useState } from 'react';
import {
  type FxSettings, type InsightEntry, type InsightTag,
  formatMoney, formatP, formatPct, tagLift, tagPairs,
} from '@/lib/archiveStats';
import { SUGGESTED_TAGS } from './TagPicker';
import { CHART, EmptyNote, GhostButton, Menu, SectionHeader, TagDot, inputStyle } from './ui';

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export default function TagsPanel({
  entries, tags, fx, canEdit, onCreate, onUpdate, onDelete, onDimension,
}: {
  entries: InsightEntry[];
  tags: InsightTag[];
  fx: FxSettings;
  canEdit: boolean;
  onCreate: (name: string, group: string) => Promise<void>;
  onUpdate: (tag: InsightTag, patch: { name?: string; group?: string; color?: string }) => Promise<void>;
  onDelete: (tag: InsightTag) => Promise<void>;
  onDimension: (dim: string) => void;
}) {
  const lifts = useMemo(
    () => tagLift(entries, tags, fx).sort((a, b) => (b.delta ?? -2) - (a.delta ?? -2) || b.n - a.n),
    [entries, tags, fx],
  );
  const pairs = useMemo(() => tagPairs(entries, tags).filter(p => p.n >= 2).slice(0, 8), [entries, tags]);
  const maxAbs = Math.max(0.01, ...lifts.map(l => Math.abs(l.delta ?? 0)));

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader
          title="Which tags go with winning"
          hint="Win rate of selected grants with each tag vs the selected grants without it"
        />
        {lifts.length === 0 ? (
          <EmptyNote>{tags.length ? 'None of the selected grants is tagged yet. Select grants on the left and use “Tag selected”.' : 'Create tags below, then tag grants from the left rail or the Data tab.'}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
                  <th className="px-3 py-2 text-left ledger-label">Tag</th>
                  <th className="px-3 py-2 text-right ledger-label">Grants</th>
                  <th className="px-3 py-2 text-right ledger-label">With</th>
                  <th className="px-3 py-2 text-right ledger-label">Without</th>
                  <th className="px-3 py-2 text-center ledger-label w-[220px]">Difference</th>
                  <th className="px-3 py-2 text-right ledger-label">p</th>
                  <th className="px-3 py-2 text-right ledger-label">Awarded</th>
                </tr>
              </thead>
              <tbody>
                {lifts.map(l => {
                  const sig = l.p != null && l.p < 0.05;
                  const thin = l.withDecided < 3 || l.withoutDecided < 3;
                  const w = l.delta != null ? (Math.abs(l.delta) / maxAbs) * 50 : 0;
                  return (
                    <tr key={l.tag.id} style={{ borderBottom: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => onDimension(l.tag.group ? `group:${l.tag.group}` : 'tags')}
                          className="flex items-center gap-1.5 hover:underline text-left" title="Break down by this tag’s group">
                          <TagDot color={l.tag.color} />
                          <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>{l.tag.name}</span>
                          {l.tag.group && <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>{l.tag.group}</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{l.n}</td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums whitespace-nowrap">
                        {formatPct(l.withRate)} <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>{l.withWon}/{l.withDecided}</span>
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums whitespace-nowrap">
                        {formatPct(l.withoutRate)} <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>{l.withoutWon}/{l.withoutDecided}</span>
                      </td>
                      <td className="px-3 py-2">
                        {l.delta == null ? (
                          <span className="block text-center" style={{ color: 'var(--ink-faint)' }}>needs decisions on both sides</span>
                        ) : (
                          <div className="flex items-center gap-2" style={{ opacity: thin ? 0.55 : 1 }}>
                            <div className="relative flex-1 h-3" aria-hidden>
                              <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: CHART.axis }} />
                              <div
                                className="absolute top-0.5 bottom-0.5"
                                style={{
                                  background: l.delta >= 0 ? CHART.up : CHART.down,
                                  left: l.delta >= 0 ? '50%' : `${50 - w}%`,
                                  width: `${Math.max(w, 0.5)}%`,
                                  borderRadius: l.delta >= 0 ? '0 3px 3px 0' : '3px 0 0 3px',
                                }}
                              />
                            </div>
                            <span className="mono-data tabular-nums w-10 text-right" style={{ fontWeight: sig ? 600 : 400, color: 'var(--ink-primary)' }}>
                              {l.delta >= 0 ? '+' : '−'}{Math.abs(Math.round(l.delta * 100))}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums" style={{ fontWeight: sig ? 600 : 400 }}>{formatP(l.p)}</td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{formatMoney(l.awarded, fx.base)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10.5px] mt-2" style={{ color: 'var(--ink-muted)' }}>
              Difference in percentage points. Bold when Fisher’s exact p &lt; 0.05; faded when either side has fewer than 3 decisions.
              Correlation, not cause — a tag may simply travel with a strong funder.
            </p>
          </div>
        )}
      </section>

      {pairs.length > 0 && (
        <section>
          <SectionHeader title="Tags that travel together" hint="Pairs of tags on the same grant" />
          <ul>
            {pairs.map(p => (
              <li key={`${p.a.id}|${p.b.id}`} className="flex items-center gap-3 py-1.5 text-xs" style={{ borderBottom: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
                <span className="flex items-center gap-1.5 min-w-0 flex-1">
                  <TagDot color={p.a.color} /><span className="truncate">{p.a.name}</span>
                  <span style={{ color: 'var(--ink-faint)' }}>+</span>
                  <TagDot color={p.b.color} /><span className="truncate">{p.b.name}</span>
                </span>
                <span className="mono-data tabular-nums" style={{ color: 'var(--ink-muted)' }}>{p.n} grants</span>
                <span className="mono-data tabular-nums w-28 text-right">
                  {p.decided ? `${formatPct(p.won / p.decided)} won` : 'no decisions'}
                  {p.decided > 0 && <span className="text-[10px] ml-1" style={{ color: 'var(--ink-muted)' }}>{p.won}/{p.decided}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TagLibrary tags={tags} canEdit={canEdit} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} />
    </div>
  );
}

function TagLibrary({
  tags, canEdit, onCreate, onUpdate, onDelete,
}: {
  tags: InsightTag[];
  canEdit: boolean;
  onCreate: (name: string, group: string) => Promise<void>;
  onUpdate: (tag: InsightTag, patch: { name?: string; group?: string; color?: string }) => Promise<void>;
  onDelete: (tag: InsightTag) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => [...new Set(tags.map(t => t.group).filter(Boolean))].sort(), [tags]);
  const grouped = useMemo(() => {
    const m = new Map<string, InsightTag[]>();
    for (const t of tags) {
      if (!m.has(t.group)) m.set(t.group, []);
      m.get(t.group)!.push(t);
    }
    return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1));
  }, [tags]);
  const existing = new Set(tags.map(t => `${t.group.toLowerCase()}|${t.name.toLowerCase()}`));
  const suggestions = SUGGESTED_TAGS
    .map(s => ({ group: s.group, names: s.names.filter(n => !existing.has(`${s.group.toLowerCase()}|${n.toLowerCase()}`)) }))
    .filter(s => s.names.length);

  async function create(n = name, g = group) {
    if (!n.trim()) return;
    setBusy(true);
    try {
      await onCreate(n.trim(), g.trim());
      if (n === name) setName('');
    } finally { setBusy(false); }
  }

  return (
    <section>
      <SectionHeader
        title="Tag library"
        hint="Shared with everyone in your organization. Group tags (Stage, Programme, Genre…) to break statistics down by group."
      />
      {canEdit && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder="New tag — e.g. EOI" className="px-2.5 py-1.5 text-xs w-52" style={inputStyle} />
          <input value={group} onChange={e => setGroup(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }}
            list="insight-library-groups" placeholder="Group — e.g. Stage" className="px-2.5 py-1.5 text-xs w-44" style={inputStyle} />
          <datalist id="insight-library-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
          <button type="button" onClick={() => create()} disabled={busy || !name.trim()}
            className="px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}>
            Add tag
          </button>
        </div>
      )}

      {canEdit && suggestions.length > 0 && tags.length < 12 && (
        <div className="mb-5 p-3" style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)' }}>
          <div className="text-[11px] mb-2" style={{ color: 'var(--ink-muted)' }}>Quick start — click to add:</div>
          <div className="space-y-1.5">
            {suggestions.map(s => (
              <div key={s.group} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] w-20 shrink-0 font-medium" style={{ color: 'var(--ink-secondary)' }}>{s.group}</span>
                {s.names.map(n => (
                  <button key={n} type="button" disabled={busy} onClick={() => create(n, s.group)}
                    className="px-2 py-0.5 text-[11px] disabled:opacity-40"
                    style={{ border: '1px dashed var(--rule-strong)', borderRadius: 999, color: 'var(--ink-secondary)', background: 'var(--surface-raised)' }}>
                    + {n}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tags.length === 0 ? (
        <EmptyNote>No tags yet.{canEdit ? '' : ' Ask a grant lead or org admin to create some.'}</EmptyNote>
      ) : (
        <div className="space-y-5">
          {grouped.map(([g, list]) => (
            <div key={g || '__u'}>
              <div className="ledger-label mb-1">{g || 'Ungrouped'}</div>
              <ul>
                {list.map(t => <TagRow key={t.id} tag={t} groups={groups} canEdit={canEdit} onUpdate={onUpdate} onDelete={onDelete} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TagRow({
  tag, groups, canEdit, onUpdate, onDelete,
}: {
  tag: InsightTag;
  groups: string[];
  canEdit: boolean;
  onUpdate: (tag: InsightTag, patch: { name?: string; group?: string; color?: string }) => Promise<void>;
  onDelete: (tag: InsightTag) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [group, setGroup] = useState(tag.group);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    const patch: { name?: string; group?: string } = {};
    if (name.trim() && name.trim() !== tag.name) patch.name = name.trim();
    if (group.trim() !== tag.group) patch.group = group.trim();
    if (Object.keys(patch).length) {
      try { await onUpdate(tag, patch); } catch { setName(tag.name); setGroup(tag.group); }
    }
    setEditing(false);
  }

  return (
    <li className="flex items-center gap-3 py-1.5 text-xs" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
      {canEdit ? (
        <Menu align="left" width={156} button={(_o, toggle) => (
          <button type="button" onClick={toggle} aria-label={`Change color of ${tag.name}`} className="p-0.5 rounded-full"
            style={{ outline: '1px solid var(--rule-subtle)', outlineOffset: 1 }}>
            <TagDot color={tag.color} size={10} />
          </button>
        )}>
          {close => (
            <div className="p-2 grid grid-cols-4 gap-2">
              {PALETTE.map(c => (
                <button key={c} type="button" aria-label={`Use ${c}`}
                  onClick={() => { onUpdate(tag, { color: c }); close(); }}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: c, outline: c === tag.color ? '2px solid var(--accent-primary)' : 'none', outlineOffset: 2 }} />
              ))}
            </div>
          )}
        </Menu>
      ) : <TagDot color={tag.color} size={10} />}

      {editing ? (
        <>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            className="px-2 py-1 text-xs w-44" style={inputStyle} aria-label="Tag name" />
          <input value={group} onChange={e => setGroup(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            list="insight-row-groups" placeholder="No group" className="px-2 py-1 text-xs w-36" style={inputStyle} aria-label="Tag group" />
          <datalist id="insight-row-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
          <GhostButton onClick={save}>Save</GhostButton>
        </>
      ) : (
        <span className="flex-1 font-medium" style={{ color: 'var(--ink-primary)' }}>{tag.name}</span>
      )}
      <span className="mono-data tabular-nums ml-auto" style={{ color: 'var(--ink-muted)' }}>{tag.usage} grant{tag.usage === 1 ? '' : 's'}</span>
      {canEdit && !editing && (
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => { setName(tag.name); setGroup(tag.group); setEditing(true); }} className="hover:underline" style={{ color: 'var(--ink-muted)' }}>Edit</button>
          {confirm ? (
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => onDelete(tag)} className="font-medium" style={{ color: 'var(--state-danger)' }}>
                Delete{tag.usage ? ` from ${tag.usage}` : ''}?
              </button>
              <button type="button" onClick={() => setConfirm(false)} style={{ color: 'var(--ink-muted)' }}>Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="hover:underline" style={{ color: 'var(--ink-muted)' }}>Delete</button>
          )}
        </span>
      )}
    </li>
  );
}
