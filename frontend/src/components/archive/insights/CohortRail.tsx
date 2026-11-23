'use client';
/**
 * The left rail: every archived grant, with filters. Checked grants are the
 * cohort every statistic is computed over; checked grants can be tagged in bulk.
 */
import { useMemo, useState } from 'react';
import {
  type InsightEntry, type InsightTag,
  outcomeClass, outcomeLabel, yearOf, stackKey, OUTCOME_STACK, CONFIDENCE_PRESETS,
} from '@/lib/archiveStats';
import TagPicker from './TagPicker';
import { Menu, TagDot, inputStyle } from './ui';

const CLASS_FILTERS = [
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'open', label: 'Pending' },
  { value: 'other', label: 'Other' },
] as const;

export default function CohortRail({
  entries, tags, selected, onSelect, canEdit, onToggleTag, onCreateTag, onSetConfidence,
}: {
  entries: InsightEntry[];
  tags: InsightTag[];
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  canEdit: boolean;
  onToggleTag: (tag: InsightTag, add: boolean, ids: string[]) => Promise<void>;
  onCreateTag: (name: string, group: string, ids: string[]) => Promise<void>;
  onSetConfidence: (ids: string[], value: number | null) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [tagMode, setTagMode] = useState<'any' | 'all' | 'none'>('any');
  const [funder, setFunder] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);
  const funders = useMemo(() => [...new Set(entries.map(e => e.funder?.trim()).filter(Boolean) as string[])].sort(), [entries]);
  const years = useMemo(() => [...new Set(entries.map(yearOf).filter((y): y is number => y != null))].sort((a, b) => a - b), [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (q && !(`${e.title} ${e.funder ?? ''} ${e.lead_pi ?? ''} ${e.program ?? ''}`.toLowerCase().includes(q))) return false;
      if (classes.size && !classes.has(outcomeClass(e.outcome))) return false;
      if (funder && (e.funder?.trim() ?? '') !== funder) return false;
      const y = yearOf(e);
      if (yearFrom && (y == null || y < Number(yearFrom))) return false;
      if (yearTo && (y == null || y > Number(yearTo))) return false;
      if (tagFilter.size) {
        const hits = [...tagFilter].filter(id => e.tag_ids.includes(id)).length;
        if (tagMode === 'any' && hits === 0) return false;
        if (tagMode === 'all' && hits < tagFilter.size) return false;
        if (tagMode === 'none' && hits > 0) return false;
      }
      return true;
    });
  }, [entries, search, classes, funder, yearFrom, yearTo, tagFilter, tagMode]);

  const filtersActive = !!(search || classes.size || funder || yearFrom || yearTo || tagFilter.size);
  const visibleSelected = visible.filter(e => selected.has(e.id)).length;
  const selectedEntries = useMemo(() => entries.filter(e => selected.has(e.id)), [entries, selected]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelect(next);
  }
  function addVisible() { onSelect(new Set([...selected, ...visible.map(e => e.id)])); }
  function onlyVisible() { onSelect(new Set(visible.map(e => e.id))); }
  function removeVisible() {
    const drop = new Set(visible.map(e => e.id));
    onSelect(new Set([...selected].filter(id => !drop.has(id))));
  }
  function clearFilters() {
    setSearch(''); setClasses(new Set()); setFunder(''); setYearFrom(''); setYearTo(''); setTagFilter(new Set());
  }

  const tagGroups = useMemo(() => {
    const m = new Map<string, InsightTag[]>();
    for (const t of tags) {
      if (!m.has(t.group)) m.set(t.group, []);
      m.get(t.group)!.push(t);
    }
    return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1));
  }, [tags]);

  const smallSelect: React.CSSProperties = { ...inputStyle, fontSize: 11, padding: '3px 6px' };

  return (
    <aside
      className="flex flex-col min-h-0 h-full"
      style={{ borderRight: '1px solid var(--rule-subtle)', background: 'var(--surface-base)' }}
      aria-label="Grants in the analysis"
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-baseline justify-between">
          <span className="ledger-label">In analysis</span>
          <span className="mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            <span style={{ color: 'var(--ink-primary)', fontWeight: 600 }}>{selected.size}</span> of {entries.length}
          </span>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title, funder, PI…"
          className="w-full mt-2 px-2.5 py-1.5 text-xs"
          style={inputStyle}
        />
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {CLASS_FILTERS.map(c => {
            const on = classes.has(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => {
                  const n = new Set(classes);
                  if (on) n.delete(c.value); else n.add(c.value);
                  setClasses(n);
                }}
                className="px-2 py-0.5 text-[11px] font-medium"
                style={{
                  borderRadius: 999,
                  border: `1px solid ${on ? 'var(--accent-primary)' : 'var(--rule-subtle)'}`,
                  background: on ? 'var(--accent-primary)' : 'transparent',
                  color: on ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
                }}
              >
                {c.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowFilters(s => !s)}
            className="ml-auto text-[11px] font-medium"
            style={{ color: showFilters || funder || yearFrom || yearTo || tagFilter.size ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
          >
            {showFilters ? 'Fewer filters' : 'More filters'}
          </button>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-2 pt-2" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] w-12 shrink-0" style={{ color: 'var(--ink-muted)' }}>Funder</span>
              <select value={funder} onChange={e => setFunder(e.target.value)} className="flex-1 min-w-0" style={smallSelect}>
                <option value="">Any</option>
                {funders.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] w-12 shrink-0" style={{ color: 'var(--ink-muted)' }}>Years</span>
              <select value={yearFrom} onChange={e => setYearFrom(e.target.value)} className="flex-1" style={smallSelect} aria-label="From year">
                <option value="">From</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>–</span>
              <select value={yearTo} onChange={e => setYearTo(e.target.value)} className="flex-1" style={smallSelect} aria-label="To year">
                <option value="">To</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {tags.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>Tags</span>
                  <select value={tagMode} onChange={e => setTagMode(e.target.value as 'any' | 'all' | 'none')} style={{ ...smallSelect, padding: '1px 4px' }} aria-label="Tag match">
                    <option value="any">has any</option>
                    <option value="all">has all</option>
                    <option value="none">has none</option>
                  </select>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {tagGroups.map(([g, list]) => (
                    <div key={g || '__u'} className="flex flex-wrap gap-1 items-center">
                      {g && <span className="text-[10px] mr-0.5" style={{ color: 'var(--ink-faint)' }}>{g}</span>}
                      {list.map(t => {
                        const on = tagFilter.has(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              const n = new Set(tagFilter);
                              if (on) n.delete(t.id); else n.add(t.id);
                              setTagFilter(n);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-px text-[10px] font-medium"
                            style={{
                              borderRadius: 999,
                              border: `1px solid ${on ? 'var(--accent-primary)' : 'var(--rule-subtle)'}`,
                              background: on ? 'var(--selection-bg)' : 'transparent',
                              color: 'var(--ink-secondary)',
                            }}
                          >
                            <TagDot color={t.color} size={6} />{t.name}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selection actions */}
        <div className="flex items-center gap-2 mt-2.5 text-[11px] flex-wrap" style={{ color: 'var(--ink-muted)' }}>
          <span>{filtersActive ? `${visible.length} shown` : 'All'}</span>
          <span style={{ color: 'var(--ink-faint)' }}>·</span>
          <button type="button" onClick={addVisible} className="font-medium hover:underline" style={{ color: 'var(--ink-secondary)' }}>
            Add{filtersActive ? ' shown' : ' all'}
          </button>
          {filtersActive && (
            <button type="button" onClick={onlyVisible} className="font-medium hover:underline" style={{ color: 'var(--ink-secondary)' }}>
              Only shown
            </button>
          )}
          <button type="button" onClick={removeVisible} className="font-medium hover:underline" style={{ color: 'var(--ink-secondary)' }}>
            Remove{filtersActive ? ' shown' : ' all'}
          </button>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="ml-auto hover:underline">Clear filters</button>
          )}
        </div>
      </div>

      {/* List */}
      <ul className="flex-1 min-h-0 overflow-y-auto" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
        {visible.length === 0 && (
          <li className="px-4 py-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
            {entries.length ? 'No grants match these filters.' : 'The archive is empty.'}
          </li>
        )}
        {visible.map(e => {
          const on = selected.has(e.id);
          const sk = OUTCOME_STACK.find(s => s.key === stackKey(e.outcome))!;
          const y = yearOf(e);
          return (
            <li key={e.id} style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
              <label
                className="flex items-start gap-2.5 px-4 py-2 cursor-pointer transition-colors"
                style={{ opacity: on ? 1 : 0.55 }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--selection-bg)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(e.id)} className="mt-0.5 shrink-0 accent-[#18181B]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium truncate" style={{ color: 'var(--ink-primary)' }} title={e.title}>{e.title}</span>
                  <span className="flex items-center gap-1.5 text-[10.5px] mt-0.5 min-w-0" style={{ color: 'var(--ink-muted)' }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sk.color }} aria-hidden />
                    <span className="shrink-0">{outcomeLabel(e.outcome)}</span>
                    {y && <span className="mono-data shrink-0">· {y}</span>}
                    {e.win_confidence != null && (
                      <span className="mono-data shrink-0" title="Our odds at submission">· {e.win_confidence}%</span>
                    )}
                    {e.funder && <span className="truncate">· {e.funder}</span>}
                  </span>
                  {e.tag_ids.length > 0 && (
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                      {e.tag_ids.map(id => tagById.get(id)).filter(Boolean).map(t => (
                        <span key={t!.id} className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--ink-secondary)' }}>
                          <TagDot color={t!.color} size={6} />{t!.name}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Bulk tagging */}
      {canEdit && (
        <div className="shrink-0 px-4 py-2.5 grid grid-cols-[1fr_auto] gap-2" style={{ borderTop: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
          <Menu
            block
            align="left"
            placement="top"
            width={268}
            button={(_open, toggle) => (
              <button
                type="button"
                disabled={!selected.size}
                onClick={toggle}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M3 11.5V4a1 1 0 011-1h7.5a1 1 0 01.7.3l8.5 8.5a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 12.2a1 1 0 01-.3-.7z" />
                </svg>
                Tag {selected.size}
              </button>
            )}
          >
            <TagPicker
              title={`Tag ${selectedEntries.length} grant${selectedEntries.length === 1 ? '' : 's'}`}
              tags={tags}
              targets={selectedEntries}
              canEdit={canEdit}
              onToggle={(t, add) => onToggleTag(t, add, selectedEntries.map(e => e.id))}
              onCreate={(name, group) => onCreateTag(name, group, selectedEntries.map(e => e.id))}
            />
          </Menu>
          <Menu
            align="right"
            placement="top"
            width={248}
            button={(open, toggle) => (
              <button
                type="button"
                disabled={!selected.size}
                onClick={toggle}
                title="Set your odds at submission on the selected grants"
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-primary)', borderRadius: 'var(--radius-sm)', background: open ? 'var(--selection-bg)' : 'var(--surface-raised)' }}
              >
                <span className="mono-data">%</span> Set odds
              </button>
            )}
          >
            {close => (
              <OddsPicker
                count={selectedEntries.length}
                current={selectedEntries.map(e => e.win_confidence)}
                onPick={async v => { await onSetConfidence(selectedEntries.map(e => e.id), v); close(); }}
              />
            )}
          </Menu>
        </div>
      )}
    </aside>
  );
}

/** Rate many grants' odds at once: presets, a custom value, or clear. */
function OddsPicker({ count, current, onPick }: {
  count: number;
  current: (number | null)[];
  onPick: (value: number | null) => Promise<void>;
}) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const same = current.length && current.every(c => c === current[0]) ? current[0] : undefined;
  async function pick(v: number | null) {
    setBusy(true);
    try { await onPick(v); } finally { setBusy(false); }
  }
  const customValue = Number(custom.replace(/%$/, ''));
  const customOk = custom.trim() !== '' && Number.isInteger(customValue) && customValue >= 0 && customValue <= 100;
  return (
    <div className="py-1">
      <div className="ledger-label px-3 pt-1.5 pb-1">Odds at submission · {count} grant{count === 1 ? '' : 's'}</div>
      {CONFIDENCE_PRESETS.map(p => (
        <button key={p.value} type="button" disabled={busy} onClick={() => pick(p.value)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ color: 'var(--ink-secondary)', background: same === p.value ? 'var(--selection-bg)' : undefined }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
          onMouseLeave={e => (e.currentTarget.style.background = same === p.value ? 'var(--selection-bg)' : 'transparent')}>
          <span>{p.label}</span>
          <span className="mono-data" style={{ color: 'var(--ink-muted)' }}>{p.value}%</span>
        </button>
      ))}
      <div className="px-3 pt-2 pb-1.5 mt-1 flex items-center gap-1.5" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
        <input value={custom} onChange={e => setCustom(e.target.value)} inputMode="numeric" placeholder="Custom"
          onKeyDown={e => { if (e.key === 'Enter' && customOk) pick(customValue); }}
          className="w-20 px-2 py-1 text-xs mono-data text-right" style={inputStyle} aria-label="Custom odds in percent" />
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>%</span>
        <button type="button" disabled={!customOk || busy} onClick={() => pick(customValue)}
          className="ml-auto px-2 py-1 text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}>
          Set
        </button>
      </div>
      <button type="button" disabled={busy} onClick={() => pick(null)}
        className="w-full text-left px-3 py-1.5 text-[11px] hover:underline disabled:opacity-50" style={{ color: 'var(--ink-muted)' }}>
        Clear odds (count fully as unrated)
      </button>
    </div>
  );
}
