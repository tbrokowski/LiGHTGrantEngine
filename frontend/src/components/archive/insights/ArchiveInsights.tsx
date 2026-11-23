'use client';
/**
 * Archive → Insights: historical statistics over a hand-picked set of
 * archived grants, broken down by tags and grant fields, with an editable
 * data grid for filling in what the numbers need.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { archive, archiveInsights } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type ConfidenceSettings, type FxSettings, type GapKey, type InsightEntry, type InsightTag,
  DEFAULT_CONFIDENCE, DEFAULT_FX, DEFAULT_USD_RATES, dimensionOptions, gapCounts, normalizeCurrency,
} from '@/lib/archiveStats';
import BreakdownPanel, { type ChartMetric } from './BreakdownPanel';
import CohortRail from './CohortRail';
import DataPanel, { type EntryPatch } from './DataPanel';
import OverviewPanel from './OverviewPanel';
import TagsPanel from './TagsPanel';
import ExportArchiveMenu from '../ExportArchiveMenu';
import { GhostButton, Menu, Segmented, inputStyle } from './ui';

type Tab = 'overview' | 'breakdown' | 'tags' | 'data';

interface SavedView {
  id: string;
  name: string;
  config: { ids?: string[]; tab?: Tab; dimension?: string; metric?: ChartMetric; base?: string; unrated?: number };
  created_by_id: string | null;
  created_by: string | null;
  updated_at: string | null;
}

interface Persisted {
  excluded?: string[];
  tab?: Tab;
  dimension?: string;
  metric?: ChartMetric;
  fx?: FxSettings;
  conf?: ConfidenceSettings;
}

function errorDetail(err: unknown, fallback: string): string {
  const d = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

function readPersisted(key: string): Persisted {
  try { return JSON.parse(localStorage.getItem(key) || '{}') as Persisted; } catch { return {}; }
}

export default function ArchiveInsights() {
  const { user } = useAuth();
  const storeKey = `archive-insights:v1:${user?.institution_id ?? 'none'}`;

  const [entries, setEntries] = useState<InsightEntry[]>([]);
  const [tags, setTags] = useState<InsightTag[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('overview');
  const [dimension, setDimension] = useState('funder');
  const [metric, setMetric] = useState<ChartMetric>('winRate');
  const [fx, setFx] = useState<FxSettings>(DEFAULT_FX);
  const [conf, setConf] = useState<ConfidenceSettings>(DEFAULT_CONFIDENCE);
  const [gap, setGap] = useState<GapKey | null>(null);
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [activeView, setActiveView] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const { data } = await archiveInsights.dataset();
      setEntries(data.entries);
      setTags(data.tags);
      setViews(data.views);
      setCanEdit(!!data.can_edit);
      if (initial) {
        const saved = readPersisted(storeKey);
        const excluded = new Set(saved.excluded ?? []);
        setSelected(new Set((data.entries as InsightEntry[]).map(e => e.id).filter(id => !excluded.has(id))));
        if (saved.tab) setTab(saved.tab);
        if (saved.metric) setMetric(saved.metric);
        if (typeof saved.conf?.unrated === 'number') setConf({ unrated: saved.conf.unrated });
        if (saved.fx?.base && saved.fx.usd) setFx({ base: saved.fx.base, usd: { ...DEFAULT_USD_RATES, ...saved.fx.usd } });
        const dims = dimensionOptions(data.tags as InsightTag[]).map(d => d.key);
        const firstGroup = dims.find(d => d.startsWith('group:'));
        setDimension(saved.dimension && dims.includes(saved.dimension) ? saved.dimension : firstGroup ?? 'funder');
        setReady(true);
      }
      setLoadError('');
    } catch (err) {
      setLoadError(errorDetail(err, 'Could not load archive statistics.'));
    } finally {
      if (initial) setLoading(false);
    }
  }, [storeKey]);

  useEffect(() => { load(true); }, [load]);

  // Remember this viewer's last setup (exclusions, so new grants join by default).
  useEffect(() => {
    if (!ready) return;
    try {
      const excluded = entries.filter(e => !selected.has(e.id)).map(e => e.id);
      localStorage.setItem(storeKey, JSON.stringify({ excluded, tab, dimension, metric, fx, conf } satisfies Persisted));
    } catch { /* storage unavailable */ }
  }, [ready, entries, selected, tab, dimension, metric, fx, conf, storeKey]);

  const cohort = useMemo(() => entries.filter(e => selected.has(e.id)), [entries, selected]);
  const cohortGaps = useMemo(() => {
    const c = gapCounts(cohort);
    return c.requested + c.awarded + c.outcome + c.year;
  }, [cohort]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateEntry = useCallback(async (id: string, patch: EntryPatch) => {
    const before = entries.find(e => e.id === id);
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
    try {
      await archive.update(id, patch as Record<string, unknown>);
    } catch (err) {
      if (before) setEntries(prev => prev.map(e => (e.id === id ? before : e)));
      toast.error(errorDetail(err, 'Could not save that change.'));
      throw err;
    }
  }, [entries]);

  const setConfidence = useCallback(async (ids: string[], value: number | null) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const before = new Map(entries.filter(e => idSet.has(e.id)).map(e => [e.id, e.win_confidence]));
    setEntries(prev => prev.map(e => (idSet.has(e.id) ? { ...e, win_confidence: value } : e)));
    try {
      await archiveInsights.setConfidence(ids, value);
      toast.success(value == null
        ? `Cleared odds on ${ids.length} grant${ids.length === 1 ? '' : 's'}`
        : `Rated ${ids.length} grant${ids.length === 1 ? '' : 's'} at ${value}%`);
    } catch (err) {
      setEntries(prev => prev.map(e => (before.has(e.id) ? { ...e, win_confidence: before.get(e.id) ?? null } : e)));
      toast.error(errorDetail(err, 'Could not save the odds.'));
    }
  }, [entries]);

  const toggleTag = useCallback(async (tag: InsightTag, add: boolean, ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    let delta = 0;
    setEntries(prev => prev.map(e => {
      if (!idSet.has(e.id)) return e;
      const has = e.tag_ids.includes(tag.id);
      if (add && !has) { delta++; return { ...e, tag_ids: [...e.tag_ids, tag.id] }; }
      if (!add && has) { delta--; return { ...e, tag_ids: e.tag_ids.filter(t => t !== tag.id) }; }
      return e;
    }));
    setTags(prev => prev.map(t => (t.id === tag.id ? { ...t, usage: Math.max(0, t.usage + delta) } : t)));
    try {
      await archiveInsights.applyTag(tag.id, ids, !add);
    } catch (err) {
      toast.error(errorDetail(err, 'Could not update tags.'));
      load();
    }
  }, [load]);

  const createTag = useCallback(async (name: string, group: string, applyTo: string[] = []) => {
    try {
      const { data } = await archiveInsights.createTag({ name, group });
      const tag = data as InsightTag;
      setTags(prev => [...prev, tag].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)));
      if (applyTo.length) await toggleTag(tag, true, applyTo);
      toast.success(`Tag “${tag.name}” created${applyTo.length ? ` on ${applyTo.length} grant${applyTo.length === 1 ? '' : 's'}` : ''}`);
    } catch (err) {
      toast.error(errorDetail(err, 'Could not create the tag.'));
      throw err;
    }
  }, [toggleTag]);

  const updateTag = useCallback(async (tag: InsightTag, patch: { name?: string; group?: string; color?: string }) => {
    try {
      const { data } = await archiveInsights.updateTag(tag.id, patch);
      setTags(prev => prev.map(t => (t.id === tag.id ? (data as InsightTag) : t)));
      if (patch.group != null && dimension === `group:${tag.group}` && !tags.some(t => t.id !== tag.id && t.group === tag.group)) {
        setDimension(patch.group ? `group:${patch.group}` : 'tags');
      }
    } catch (err) {
      toast.error(errorDetail(err, 'Could not update the tag.'));
      throw err;
    }
  }, [dimension, tags]);

  const deleteTag = useCallback(async (tag: InsightTag) => {
    try {
      await archiveInsights.deleteTag(tag.id);
      setTags(prev => prev.filter(t => t.id !== tag.id));
      setEntries(prev => prev.map(e => (e.tag_ids.includes(tag.id) ? { ...e, tag_ids: e.tag_ids.filter(t => t !== tag.id) } : e)));
      if (dimension === `group:${tag.group}` && !tags.some(t => t.id !== tag.id && t.group === tag.group)) setDimension('funder');
    } catch (err) {
      toast.error(errorDetail(err, 'Could not delete the tag.'));
    }
  }, [dimension, tags]);

  // ── Saved views ────────────────────────────────────────────────────────────

  const currentConfig = () => ({ ids: [...selected], tab, dimension, metric, base: fx.base, unrated: conf.unrated });

  function applyView(v: SavedView) {
    const known = new Set(entries.map(e => e.id));
    const ids = (v.config.ids ?? []).filter(id => known.has(id));
    setSelected(new Set(ids));
    if (v.config.tab) setTab(v.config.tab);
    if (v.config.dimension && dimensionOptions(tags).some(d => d.key === v.config.dimension)) setDimension(v.config.dimension);
    if (v.config.metric) setMetric(v.config.metric);
    if (v.config.base) setFx(f => ({ ...f, base: v.config.base! }));
    if (typeof v.config.unrated === 'number') setConf({ unrated: v.config.unrated });
    setActiveView(v.id);
    const missing = (v.config.ids?.length ?? 0) - ids.length;
    if (missing > 0) toast.message(`${missing} grant${missing === 1 ? ' in this view was' : 's in this view were'} deleted from the archive.`);
  }

  async function saveView(name: string) {
    try {
      const { data } = await archiveInsights.createView({ name, config: currentConfig() });
      setViews(prev => [...prev, data as SavedView].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveView((data as SavedView).id);
      toast.success(`Saved view “${name}”`);
    } catch (err) {
      toast.error(errorDetail(err, 'Could not save the view.'));
    }
  }

  async function overwriteView(v: SavedView) {
    try {
      const { data } = await archiveInsights.updateView(v.id, { config: currentConfig() });
      setViews(prev => prev.map(x => (x.id === v.id ? (data as SavedView) : x)));
      toast.success(`Updated “${v.name}”`);
    } catch (err) {
      toast.error(errorDetail(err, 'Could not update the view.'));
    }
  }

  async function removeView(v: SavedView) {
    try {
      await archiveInsights.deleteView(v.id);
      setViews(prev => prev.filter(x => x.id !== v.id));
      if (activeView === v.id) setActiveView(null);
    } catch (err) {
      toast.error(errorDetail(err, 'Could not delete the view.'));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--ink-muted)' }}>Loading statistics…</div>;
  }
  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
        <span>{loadError}</span>
        <GhostButton onClick={() => load(true)}>Try again</GhostButton>
      </div>
    );
  }

  const currentView = views.find(v => v.id === activeView) ?? null;

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
      <div className="md:w-[300px] shrink-0 max-h-[42vh] md:max-h-none min-h-0 flex flex-col">
        <CohortRail
          entries={entries}
          tags={tags}
          selected={selected}
          onSelect={s => { setSelected(s); setActiveView(null); }}
          canEdit={canEdit}
          onToggleTag={toggleTag}
          onCreateTag={(n, g, ids) => createTag(n, g, ids)}
          onSetConfidence={setConfidence}
        />
      </div>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-6 py-2.5 flex items-center gap-3 flex-wrap shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          <Segmented<Tab>
            value={tab}
            onChange={t => setTab(t)}
            ariaLabel="Insights section"
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'breakdown', label: 'Breakdown' },
              { value: 'tags', label: `Tags${tags.length ? ` · ${tags.length}` : ''}` },
              {
                value: 'data',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    Data
                    {cohortGaps > 0 && (
                      <span className="mono-data text-[10px] px-1 rounded-full" style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)' }}
                        title="Missing amounts, outcomes or years in the selected grants">
                        {cohortGaps}
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            <ViewsMenu
              views={views}
              current={currentView}
              userId={user?.id}
              canEdit={canEdit}
              onApply={applyView}
              onSave={saveView}
              onOverwrite={overwriteView}
              onDelete={removeView}
            />
            <CurrencyMenu fx={fx} onChange={setFx} entries={entries} />
            <ExportArchiveMenu scopeLabel="Selected" scopeIds={cohort.map(e => e.id)} scopeIsAll={cohort.length === entries.length} totalCount={entries.length} />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {entries.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
              The archive is empty. Add past submissions in the List tab and their statistics appear here.
            </div>
          ) : tab === 'overview' ? (
            <OverviewPanel
              entries={cohort}
              tags={tags}
              fx={fx}
              conf={conf}
              onConf={setConf}
              onGap={g => { setGap(g); setScope('selected'); setTab('data'); }}
              onDimension={d => { setDimension(d); setTab('breakdown'); }}
            />
          ) : tab === 'breakdown' ? (
            cohort.length ? (
              <BreakdownPanel
                entries={cohort}
                tags={tags}
                fx={fx}
                conf={conf}
                dimension={dimension}
                onDimension={setDimension}
                metric={metric}
                onMetric={setMetric}
                onSelectOnly={ids => { setSelected(new Set(ids)); setActiveView(null); setTab('overview'); }}
              />
            ) : <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>Select grants on the left to compare them.</p>
          ) : tab === 'tags' ? (
            <TagsPanel
              entries={cohort}
              tags={tags}
              fx={fx}
              canEdit={canEdit}
              onCreate={(n, g) => createTag(n, g)}
              onUpdate={updateTag}
              onDelete={deleteTag}
              onDimension={d => { setDimension(d); setTab('breakdown'); }}
            />
          ) : (
            <DataPanel
              entries={entries}
              selected={selected}
              tags={tags}
              fx={fx}
              canEdit={canEdit}
              gap={gap}
              onGap={setGap}
              scope={scope}
              onScope={setScope}
              onUpdate={updateEntry}
              onToggleSelected={id => {
                const n = new Set(selected);
                if (n.has(id)) n.delete(id); else n.add(id);
                setSelected(n);
                setActiveView(null);
              }}
              onToggleTag={toggleTag}
              onCreateTag={(n, g, ids) => createTag(n, g, ids)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Toolbar menus ────────────────────────────────────────────────────────────

function ViewsMenu({
  views, current, userId, canEdit, onApply, onSave, onOverwrite, onDelete,
}: {
  views: SavedView[];
  current: SavedView | null;
  userId?: string;
  canEdit: boolean;
  onApply: (v: SavedView) => void;
  onSave: (name: string) => Promise<void>;
  onOverwrite: (v: SavedView) => Promise<void>;
  onDelete: (v: SavedView) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const mayChange = (v: SavedView) => canEdit || v.created_by_id === userId;
  return (
    <Menu width={300} button={(open, toggle) => (
      <GhostButton onClick={toggle} active={open} title="Saved views">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 4h14v17l-7-4-7 4V4z" />
        </svg>
        <span className="max-w-[140px] truncate">{current ? current.name : 'Views'}</span>
      </GhostButton>
    )}>
      {close => (
        <div className="py-1">
          <div className="ledger-label px-3 pt-1.5 pb-1">Saved views · shared with your org</div>
          {views.length === 0 && <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>None yet. Save the current selection to come back to it.</p>}
          <ul className="max-h-60 overflow-y-auto">
            {views.map(v => (
              <li key={v.id} className="group flex items-center gap-2 px-3 py-1.5 text-xs"
                style={{ background: current?.id === v.id ? 'var(--selection-bg)' : undefined }}>
                <button type="button" className="flex-1 text-left min-w-0" onClick={() => { onApply(v); close(); }}>
                  <span className="block truncate font-medium" style={{ color: 'var(--ink-primary)' }}>{v.name}</span>
                  <span className="block text-[10.5px] truncate" style={{ color: 'var(--ink-muted)' }}>
                    {v.config.ids?.length ?? 0} grants{v.created_by ? ` · ${v.created_by}` : ''}
                  </span>
                </button>
                {mayChange(v) && (
                  <span className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {current?.id === v.id && (
                      <button type="button" onClick={() => onOverwrite(v)} className="text-[11px] hover:underline" style={{ color: 'var(--ink-secondary)' }}
                        title="Replace this view with the current selection and settings">Update</button>
                    )}
                    <button type="button" onClick={() => onDelete(v)} aria-label={`Delete view ${v.name}`} className="text-[11px] hover:underline" style={{ color: 'var(--state-danger)' }}>
                      Delete
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="px-3 pt-2 pb-2 mt-1 flex items-center gap-1.5" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={async e => { if (e.key === 'Enter' && name.trim()) { await onSave(name.trim()); setName(''); close(); } }}
              placeholder="Save current as… e.g. Horizon EOIs" className="flex-1 px-2 py-1 text-xs" style={inputStyle} />
            <button type="button" disabled={!name.trim()} onClick={async () => { await onSave(name.trim()); setName(''); close(); }}
              className="px-2 py-1 text-xs font-medium disabled:opacity-40"
              style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}>
              Save
            </button>
          </div>
        </div>
      )}
    </Menu>
  );
}

function CurrencyMenu({ fx, onChange, entries }: { fx: FxSettings; onChange: (fx: FxSettings) => void; entries: InsightEntry[] }) {
  const used = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      const c = normalizeCurrency(e.currency);
      if (c && (e.requested_amount != null || e.awarded_amount != null)) s.add(c);
    }
    return [...s].sort();
  }, [entries]);
  const bases = [...new Set([...used, 'USD', 'EUR', 'GBP', 'CHF'])].sort();
  const others = used.filter(c => c !== fx.base);

  const rel = (c: string) => {
    const from = fx.usd[c], to = fx.usd[fx.base];
    return from && to ? from / to : null;
  };
  function setRate(c: string, value: string) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0 || !fx.usd[fx.base]) return;
    onChange({ ...fx, usd: { ...fx.usd, [c]: v * fx.usd[fx.base] } });
  }

  return (
    <Menu width={280} button={(open, toggle) => (
      <GhostButton onClick={toggle} active={open} title="Currency for totals">
        <span className="mono-data">{fx.base}</span>
      </GhostButton>
    )}>
      <div className="p-3 space-y-3">
        <label className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          Show totals in
          <select value={fx.base} onChange={e => onChange({ ...fx, base: e.target.value })} className="px-2 py-1 text-xs" style={inputStyle}>
            {bases.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {!fx.usd[fx.base] && (
          <p className="text-[11px]" style={{ color: 'var(--state-danger)' }}>No rate for {fx.base}. Pick another base currency.</p>
        )}
        {others.length > 0 && (
          <div>
            <div className="ledger-label mb-1.5">Exchange rates</div>
            <div className="space-y-1.5">
              {others.map(c => {
                const r = rel(c);
                return (
                  <label key={c} className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    <span className="mono-data whitespace-nowrap shrink-0">1 {c} =</span>
                    <input
                      key={`${c}-${fx.base}`}
                      defaultValue={r != null ? String(Number(r.toPrecision(4))) : ''}
                      placeholder="rate"
                      onBlur={e => setRate(c, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="flex-1 min-w-0 px-2 py-1 text-xs mono-data text-right"
                      style={{ ...inputStyle, borderColor: r == null ? 'var(--state-warning)' : 'var(--rule-subtle)' }}
                    />
                    <span className="mono-data w-9" style={{ color: 'var(--ink-muted)' }}>{fx.base}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-[10.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          Default rates are approximate. Edit them to match your reporting rates; they’re remembered in this browser.
        </p>
        <button type="button" onClick={() => onChange({ base: fx.base, usd: { ...DEFAULT_USD_RATES } })}
          className="text-[11px] hover:underline" style={{ color: 'var(--ink-secondary)' }}>
          Reset rates
        </button>
      </div>
    </Menu>
  );
}
