'use client';
/**
 * Find, toggle, or create tags for one or many grants.
 * Typing "Stage: EOI" creates the tag "EOI" in the group "Stage".
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import type { InsightEntry, InsightTag } from '@/lib/archiveStats';
import { TagDot, inputStyle } from './ui';

export const SUGGESTED_TAGS: { group: string; names: string[] }[] = [
  { group: 'Stage', names: ['EOI', 'Full proposal', 'Resubmission'] },
  { group: 'Programme', names: ['Horizon Europe', 'NIH', 'Wellcome'] },
  { group: 'Genre', names: ['Research', 'Capacity building', 'Fellowship', 'Infrastructure'] },
];

export function parseTagInput(text: string, fallbackGroup: string): { name: string; group: string } {
  const i = text.indexOf(':');
  if (i > 0) return { group: text.slice(0, i).trim(), name: text.slice(i + 1).trim() };
  return { group: fallbackGroup.trim(), name: text.trim() };
}

export default function TagPicker({
  tags, targets, canEdit, onToggle, onCreate, title,
}: {
  tags: InsightTag[];
  targets: InsightEntry[];
  canEdit: boolean;
  onToggle: (tag: InsightTag, add: boolean) => Promise<void> | void;
  onCreate: (name: string, group: string) => Promise<void> | void;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const groups = useMemo(() => [...new Set(tags.map(t => t.group).filter(Boolean))].sort(), [tags]);
  const parsed = parseTagInput(q, group);
  const needle = parsed.name.toLowerCase();
  const visible = tags.filter(t => !needle || t.name.toLowerCase().includes(needle) || t.group.toLowerCase().includes(needle));
  const exact = tags.some(t => t.name.toLowerCase() === needle && t.group.toLowerCase() === parsed.group.toLowerCase());

  const grouped = useMemo(() => {
    const m = new Map<string, InsightTag[]>();
    for (const t of visible) {
      const k = t.group || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1));
  }, [visible]);

  const countWith = (t: InsightTag) => targets.filter(e => e.tag_ids.includes(t.id)).length;

  async function toggle(t: InsightTag) {
    if (!canEdit || !targets.length) return;
    const all = countWith(t) === targets.length;
    setBusy(t.id);
    try { await onToggle(t, !all); } finally { setBusy(null); }
  }

  async function create() {
    if (!parsed.name || exact) return;
    setBusy('__create');
    try {
      await onCreate(parsed.name, parsed.group);
      setQ('');
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col max-h-[420px]">
      <div className="p-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        {title && <div className="ledger-label px-1 pb-1.5">{title}</div>}
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
          placeholder={canEdit ? 'Find or create — e.g. Stage: EOI' : 'Find a tag'}
          className="w-full px-2 py-1.5 text-xs"
          style={inputStyle}
        />
      </div>
      <div className="overflow-y-auto flex-1 py-1">
        {grouped.length === 0 && (
          <p className="px-3 py-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {tags.length ? 'No matching tags.' : 'No tags yet.'}
          </p>
        )}
        {grouped.map(([g, list]) => (
          <div key={g || '__ungrouped'} className="pb-1">
            <div className="ledger-label px-3 pt-1.5 pb-0.5">{g || 'Ungrouped'}</div>
            {list.map(t => {
              const n = countWith(t);
              const state = n === 0 ? 'none' : n === targets.length ? 'all' : 'some';
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canEdit || !targets.length || busy != null}
                  onClick={() => toggle(t)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors disabled:cursor-default"
                  style={{ color: 'var(--ink-secondary)', opacity: busy === t.id ? 0.5 : 1 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span
                    aria-hidden
                    className="w-3.5 h-3.5 shrink-0 flex items-center justify-center text-[10px] leading-none"
                    style={{
                      border: `1px solid ${state === 'none' ? 'var(--rule-strong)' : 'var(--accent-primary)'}`,
                      borderRadius: 3,
                      background: state === 'all' ? 'var(--accent-primary)' : 'transparent',
                      color: state === 'all' ? 'var(--ink-inverse)' : 'var(--accent-primary)',
                    }}
                  >
                    {state === 'all' ? '✓' : state === 'some' ? '–' : ''}
                  </span>
                  <TagDot color={t.color} />
                  <span className="flex-1 truncate">{t.name}</span>
                  {targets.length > 1 && n > 0 && (
                    <span className="mono-data text-[10px]" style={{ color: 'var(--ink-muted)' }}>{n}/{targets.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {canEdit && parsed.name && !exact && (
        <div className="p-2 space-y-1.5" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {!q.includes(':') && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>Group</span>
              <input
                list="insight-tag-groups"
                value={group}
                onChange={e => setGroup(e.target.value)}
                placeholder="optional — e.g. Stage"
                className="flex-1 px-2 py-1 text-[11px]"
                style={inputStyle}
              />
              <datalist id="insight-tag-groups">
                {groups.map(g => <option key={g} value={g} />)}
              </datalist>
            </div>
          )}
          <button
            type="button"
            onClick={create}
            disabled={busy != null}
            className="w-full px-2 py-1.5 text-xs font-medium text-left disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}
          >
            {busy === '__create' ? 'Creating…' : (
              <>Create “{parsed.name}”{parsed.group ? ` in ${parsed.group}` : ''}{targets.length ? ` and tag ${targets.length === 1 ? 'this grant' : `${targets.length} grants`}` : ''}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
