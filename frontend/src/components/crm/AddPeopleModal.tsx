'use client';
import { useEffect, useMemo, useState } from 'react';
import { partners as partnersApi, partnerGroups } from '@/lib/api';
import CrmModal, { fieldStyle, errDetail } from './CrmModal';
import { Avatar, PriorityBars, Segmented, btnPrimary, btnQuiet } from './crmUi';

interface PreviewRow {
  id: string;
  name: string;
  organization?: string | null;
  priority: number;
  matched?: string[];
  in_group: boolean;
}

/** Add people to a group — by picking tags (with a live preview) or by name. */
export default function AddPeopleModal({
  group, memberIds, onClose, onAdded,
}: {
  group: { id: string; name: string; color?: string | null };
  memberIds: string[];
  onClose: () => void;
  onAdded: (n: number) => void;
}) {
  const [mode, setMode] = useState<'tags' | 'name'>('tags');
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [match, setMatch] = useState<'any' | 'all'>('any');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PreviewRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inGroup = useMemo(() => new Set(memberIds), [memberIds]);

  useEffect(() => { partnerGroups.allTags().then(r => setAllTags(r.data || [])).catch(() => {}); }, []);

  useEffect(() => {
    if (mode !== 'tags') return;
    if (!tags.length) { setPreview([]); return; }
    let live = true;
    partnerGroups.previewMembers(group.id, tags, match)
      .then(r => { if (live) setPreview(r.data || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [group.id, tags, match, mode]);

  useEffect(() => {
    if (mode !== 'name') return;
    const t = setTimeout(() => {
      partnersApi.list({ q: q || undefined, limit: 40, sort_by: 'priority', sort_dir: 'desc' })
        .then(r => setResults((r.data || []).map((p: { id: string; name: string; organization?: string; priority?: number }) => ({
          id: p.id, name: p.name, organization: p.organization, priority: p.priority ?? 1, in_group: inGroup.has(p.id),
        }))))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, mode, inGroup]);

  const rows = mode === 'tags' ? preview : results;
  const toAdd = mode === 'tags'
    ? preview.filter(r => !r.in_group && !excluded.has(r.id))
    : results.filter(r => !r.in_group && picked.has(r.id));
  const already = rows.filter(r => r.in_group).length;

  function isChecked(r: PreviewRow) {
    if (r.in_group) return false;
    return mode === 'tags' ? !excluded.has(r.id) : picked.has(r.id);
  }

  function toggle(r: PreviewRow) {
    const set = mode === 'tags' ? setExcluded : setPicked;
    set(prev => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
      return next;
    });
  }

  async function add() {
    if (!toAdd.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await partnerGroups.addMembers(group.id, { partner_ids: toAdd.map(r => r.id) });
      onAdded(res.data?.added ?? toAdd.length);
      onClose();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t add those people.'));
    } finally { setBusy(false); }
  }

  const shownTags = allTags.filter(t => !tagFilter || t.tag.toLowerCase().includes(tagFilter.toLowerCase())).slice(0, 40);

  return (
    <CrmModal
      title={`Add people to ${group.name}`}
      subtitle={mode === 'tags' ? 'Pick tags. Everyone who matches shows below; uncheck anyone you don’t want.' : 'Search by name, institution or tag.'}
      accent={group.color}
      width="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          <p className="text-xs flex-1" style={{ color: error ? 'var(--state-danger)' : 'var(--ink-muted)' }}>
            {error || (rows.length ? `${rows.length} match · ${already} already in the group · ${toAdd.length} selected` : '')}
          </p>
          <button type="button" onClick={onClose} className="text-sm px-4 h-9" style={btnQuiet}>Cancel</button>
          <button type="button" onClick={add} disabled={busy || !toAdd.length} className="text-sm px-4 h-9 font-medium disabled:opacity-40" style={btnPrimary}>
            {busy ? 'Adding…' : toAdd.length ? `Add ${toAdd.length} ${toAdd.length === 1 ? 'person' : 'people'}` : 'Add people'}
          </button>
        </>
      }
    >
      <div className="px-6 py-4 space-y-3" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Segmented label="Add by" value={mode} onChange={setMode} options={[{ value: 'tags', label: 'By tags' }, { value: 'name', label: 'By name' }]} />
          {mode === 'tags' ? (
            <>
              <input value={tagFilter} onChange={e => setTagFilter(e.target.value)} placeholder="Filter tags…" aria-label="Filter tags"
                className="px-3 h-8 text-sm flex-1 min-w-[140px]" style={fieldStyle} />
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Match</span>
              <Segmented label="Match mode" value={match} onChange={setMatch} options={[{ value: 'any', label: 'Any tag' }, { value: 'all', label: 'All tags' }]} />
            </>
          ) : (
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" aria-label="Search people"
              className="px-3 h-8 text-sm flex-1" style={fieldStyle} />
          )}
        </div>
        {mode === 'tags' && (
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {shownTags.map(({ tag, count }) => {
              const on = tags.includes(tag);
              return (
                <button key={tag} type="button" aria-pressed={on}
                  onClick={() => { setExcluded(new Set()); setTags(t => on ? t.filter(x => x !== tag) : [...t, tag]); }}
                  className="h-7 px-3 text-xs font-medium rounded-full transition-colors"
                  style={{
                    border: `1px solid ${on ? (group.color || 'var(--ink-primary)') : 'var(--rule-subtle)'}`,
                    background: on ? 'var(--surface-sunken)' : 'var(--surface-base)',
                    color: on ? (group.color || 'var(--ink-primary)') : 'var(--ink-secondary)',
                  }}>
                  {tag} <span className="mono-data opacity-70">{count}</span>
                </button>
              );
            })}
            {!allTags.length && <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>No tags yet — add tags to people first, or add by name.</span>}
          </div>
        )}
      </div>

      <div className="min-h-[240px]">
        {rows.map(r => (
          <label key={r.id} className="flex items-center gap-3 px-6 py-2 cursor-pointer" style={{ borderBottom: '1px solid var(--rule-subtle)', opacity: r.in_group ? 0.55 : 1 }}>
            <input type="checkbox" checked={isChecked(r)} disabled={r.in_group} onChange={() => toggle(r)} />
            <Avatar name={r.name} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium truncate" style={{ color: 'var(--ink-primary)' }}>{r.name}</span>
              <span className="block text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{r.organization || '—'}</span>
            </span>
            {r.matched && (
              <span className="flex gap-1">
                {r.matched.map(t => (
                  <span key={t} className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-sunken)', color: group.color || 'var(--ink-secondary)' }}>{t}</span>
                ))}
              </span>
            )}
            <PriorityBars value={r.priority} size="sm" />
            {r.in_group && <span className="text-[11px] w-16 text-right" style={{ color: 'var(--ink-muted)' }}>Already in</span>}
          </label>
        ))}
        {!rows.length && (
          <p className="px-6 py-12 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
            {mode === 'tags' ? (tags.length ? 'Nobody has those tags.' : 'Pick one or more tags to see who matches.') : 'No one found.'}
          </p>
        )}
      </div>
    </CrmModal>
  );
}
