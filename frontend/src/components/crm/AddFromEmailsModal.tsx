'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, AlertCircle, Minus, X } from 'lucide-react';
import { partners as partnersApi, partnerGroups } from '@/lib/api';
import { GroupRef, PriorityBars, Segmented } from './crmUi';

interface ParsedContact {
  email: string;
  name: string;
  name_guessed: boolean;
  domain: string;
  personal_domain: boolean;
  is_self: boolean;
  existing_partner_id: string | null;
  existing_name: string | null;
}

interface ResearchRow {
  id: string;
  name: string;
  email: string;
  title?: string | null;
  organization?: string | null;
  enrichment_status: string;
  has_bio: boolean;
}

type Phase = 'paste' | 'review' | 'progress';

const POLL_MS = 3000;

function errDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

function StatusMark({ status }: { status: string }) {
  if (status === 'pending') return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--ink-muted)' }} />;
  if (status === 'done') return <Check className="w-3.5 h-3.5" style={{ color: 'var(--state-success)' }} />;
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--state-danger)' }} />;
  return <Minus className="w-3.5 h-3.5" style={{ color: 'var(--ink-faint)' }} />;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Researching…',
  done: 'Profile filled',
  not_found: 'Nothing found online',
  failed: 'Research failed',
  none: 'Not researched',
};

export default function AddFromEmailsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>('paste');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [research, setResearch] = useState(true);
  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [priority, setPriority] = useState<1 | 2 | 3>(1);
  const [rowPrio, setRowPrio] = useState<Record<string, number>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [knownTags, setKnownTags] = useState<{ tag: string; count: number }[]>([]);

  useEffect(() => { partnerGroups.list().then(r => setGroups(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { partnerGroups.allTags().then(r => setKnownTags(r.data || [])).catch(() => {}); }, []);

  function addTag(raw: string) {
    const t = raw.trim().replace(/,+$/, '').trim();
    if (!t) return;
    setTags(ts => ts.some(x => x.toLowerCase() === t.toLowerCase()) ? ts : [...ts, t]);
    setTagInput('');
  }

  const tagSuggestions = knownTags
    .filter(k => !tags.some(t => t.toLowerCase() === k.tag.toLowerCase()))
    .filter(k => !tagInput.trim() || k.tag.toLowerCase().includes(tagInput.trim().toLowerCase()))
    .slice(0, 8);

  async function createGroup() {
    const name = newGroup.trim();
    if (!name) return;
    try {
      const res = await partnerGroups.create({ name });
      setGroups(gs => [...gs, { id: res.data.id, name }]);
      setGroupIds(ids => [...ids, res.data.id]);
      setNewGroup('');
    } catch (err) {
      setError(errDetail(err, 'Couldn’t create that group.'));
    }
  }

  const [rows, setRows] = useState<ResearchRow[]>([]);
  const [skipped, setSkipped] = useState(0);

  async function handleParse() {
    setBusy(true);
    setError(null);
    try {
      const res = await partnersApi.parseEmailList(text);
      const list: ParsedContact[] = res.data.contacts;
      if (!list.length) { setError('No email addresses found in that text.'); return; }
      setContacts(list);
      setNames(Object.fromEntries(list.map(c => [c.email, c.name])));
      setSelected(new Set(list.filter(c => !c.is_self && !c.existing_partner_id).map(c => c.email)));
      setPhase('review');
    } catch (err) {
      setError(errDetail(err, 'Couldn’t read that list.'));
    } finally { setBusy(false); }
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const payload = contacts
        .filter(c => selected.has(c.email))
        .map(c => {
          const name = (names[c.email] || '').trim() || c.name;
          // An edited name is a real name — research shouldn't replace it.
          return {
            email: c.email, name, name_guessed: c.name_guessed && name === c.name,
            ...(rowPrio[c.email] ? { priority: rowPrio[c.email] } : {}),
          };
        });
      const res = await partnersApi.bulkFromEmails(payload, research, { group_ids: groupIds, priority, tags: tagInput.trim() ? [...tags, tagInput.trim()] : tags });
      const created: { id: string; name: string; email: string }[] = res.data.created;
      setSkipped(res.data.skipped_existing.length);
      setRows(created.map(c => ({
        ...c, enrichment_status: research ? 'pending' : 'none', has_bio: false,
      })));
      setPhase('progress');
      onChanged();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t add those contacts.'));
    } finally { setBusy(false); }
  }

  const pendingIds = useMemo(() => rows.filter(r => r.enrichment_status === 'pending').map(r => r.id), [rows]);
  const pendingKey = pendingIds.join(',');

  useEffect(() => {
    if (phase !== 'progress' || !pendingKey) return;
    const ids = pendingKey.split(',');
    const t = setTimeout(async () => {
      try {
        const res = await partnersApi.researchStatus(ids);
        const byId = new Map<string, ResearchRow>(res.data.map((r: ResearchRow) => [r.id, r]));
        setRows(prev => prev.map(r => byId.get(r.id) ?? r));
      } catch { /* keep polling */ }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [phase, pendingKey, rows]);

  const doneCount = rows.length - pendingIds.length;
  const selectable = contacts.filter(c => !c.existing_partner_id);
  const allSelected = selectable.length > 0 && selectable.every(c => selected.has(c.email));

  function toggle(email: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  function close() {
    if (phase === 'progress') onChanged();
    onClose();
  }

  const primaryBtn: React.CSSProperties = { background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' };
  const secondaryBtn: React.CSSProperties = { border: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)', borderRadius: 'var(--radius-sm)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }}>
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col"
        style={{ background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
      >
        <div className="px-6 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Add partners from emails</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {phase === 'paste' && 'Paste a To:/Cc: line, a list of addresses, or a whole thread.'}
              {phase === 'review' && `${contacts.length} address${contacts.length !== 1 ? 'es' : ''} found · ${selected.size} selected`}
              {phase === 'progress' && (research
                ? `Researching ${rows.length} contact${rows.length !== 1 ? 's' : ''} online · ${doneCount} of ${rows.length} finished`
                : `Added ${rows.length} contact${rows.length !== 1 ? 's' : ''}`)}
            </p>
          </div>
          <button onClick={close} aria-label="Close" style={{ color: 'var(--ink-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        {phase === 'paste' && (
          <div className="px-6 py-5 space-y-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={12}
              autoFocus
              placeholder={'Jane Doe <jane@uni.edu>, "Smith, John" <jsmith@org.org>, …'}
              className="w-full px-3 py-2 text-sm resize-none mono-data"
              style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', color: 'var(--ink-secondary)', outline: 'none' }}
            />
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              You’ll review the list before anything is added. Each new contact is then looked up online: their
              institution’s profile pages, ORCID and publications, to fill in title, organization, bio and expertise.
            </p>
          </div>
        )}

        {phase === 'review' && (
          <div className="px-6 py-3 flex flex-col gap-2.5 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="ledger-label w-16">Groups</span>
              {groups.map(g => {
                const on = groupIds.includes(g.id);
                return (
                  <button key={g.id} type="button" aria-pressed={on}
                    onClick={() => setGroupIds(ids => on ? ids.filter(x => x !== g.id) : [...ids, g.id])}
                    className="h-7 px-2.5 text-xs font-medium rounded-full flex items-center gap-1.5"
                    style={{
                      border: `1px solid ${on ? (g.color || 'var(--ink-primary)') : 'var(--rule-subtle)'}`,
                      background: on ? 'var(--surface-sunken)' : 'var(--surface-base)',
                      color: on ? (g.color || 'var(--ink-primary)') : 'var(--ink-secondary)',
                    }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: g.color || 'var(--ink-muted)' }} />{g.name}
                  </button>
                );
              })}
              <input value={newGroup} onChange={e => setNewGroup(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createGroup(); }}
                placeholder="+ New group…" aria-label="New group name"
                className="h-7 px-2.5 text-xs rounded-full w-36" style={{ border: '1px dashed var(--rule-strong)', background: 'transparent', outline: 'none', color: 'var(--ink-primary)' }} />
            </div>
            <div className="flex items-start gap-2">
              <span className="ledger-label w-16 shrink-0 pt-2">Tags</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {tags.map(t => (
                    <span key={t} className="h-7 pl-2.5 pr-1.5 text-xs font-medium rounded-full flex items-center gap-1"
                      style={{ background: 'var(--surface-sunken)', color: 'var(--ink-primary)', border: '1px solid var(--rule-strong)' }}>
                      {t}
                      <button type="button" onClick={() => setTags(ts => ts.filter(x => x !== t))} aria-label={`Remove tag ${t}`} style={{ color: 'var(--ink-muted)' }}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={e => { const v = e.target.value; if (v.endsWith(',')) addTag(v); else setTagInput(v); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); }
                      if (e.key === 'Backspace' && !tagInput && tags.length) setTags(ts => ts.slice(0, -1));
                    }}
                    onBlur={() => addTag(tagInput)}
                    placeholder={tags.length ? 'Add another…' : 'Type a tag and press Enter, e.g. consortium-2026'}
                    aria-label="Tags for everyone added"
                    className="h-7 px-2.5 text-xs rounded-full flex-1 min-w-[180px]"
                    style={{ border: '1px dashed var(--rule-strong)', background: 'transparent', outline: 'none', color: 'var(--ink-primary)' }}
                  />
                </div>
                {tagSuggestions.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mt-1.5">
                    <span className="text-[11px] mr-0.5" style={{ color: 'var(--ink-muted)' }}>In use:</span>
                    {tagSuggestions.map(k => (
                      <button key={k.tag} type="button" onMouseDown={e => e.preventDefault()} onClick={() => addTag(k.tag)}
                        className="h-6 px-2 text-[11px] rounded-full" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
                        + {k.tag} <span className="mono-data opacity-60">{k.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="ledger-label w-16">Priority</span>
              <Segmented label="Priority for everyone added" value={priority} onChange={setPriority}
                options={[{ value: 1, label: 'P1 · Regular' }, { value: 2, label: 'P2 · Medium' }, { value: 3, label: 'P3 · High' }]} />
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>for everyone — change individuals in the list</span>
            </div>
          </div>
        )}

        {phase === 'review' && (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--surface-sunken)' }}>
                <tr style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                  <th className="px-4 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map(c => c.email)))}
                    />
                  </th>
                  <th className="text-left px-2 py-2 ledger-label">Name</th>
                  <th className="text-left px-2 py-2 ledger-label">Email</th>
                  <th className="text-left px-2 py-2 ledger-label">Priority</th>
                  <th className="text-left px-2 py-2 ledger-label">Note</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => {
                  const existing = !!c.existing_partner_id;
                  return (
                    <tr key={c.email} style={{ borderBottom: '1px solid var(--rule-subtle)', opacity: existing ? 0.55 : 1 }}>
                      <td className="px-4 py-1.5">
                        <input type="checkbox" disabled={existing} checked={selected.has(c.email)} onChange={() => toggle(c.email)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={names[c.email] ?? ''}
                          onChange={e => setNames(n => ({ ...n, [c.email]: e.target.value }))}
                          disabled={existing}
                          className="w-full bg-transparent px-1 py-0.5 text-sm"
                          style={{ color: 'var(--ink-primary)', outline: 'none', borderBottom: '1px dashed transparent' }}
                          onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--rule-strong)')}
                          onBlur={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                        />
                      </td>
                      <td className="px-2 py-1.5 mono-data text-xs" style={{ color: 'var(--ink-muted)' }}>{c.email}</td>
                      <td className="px-2 py-1.5">
                        {!existing && (
                          <PriorityBars value={rowPrio[c.email] ?? priority} onChange={p => setRowPrio(r => ({ ...r, [c.email]: p }))} />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {existing ? (
                          <Link href={`/partners/${c.existing_partner_id}`} style={{ color: 'var(--ink-secondary)', textDecoration: 'underline' }}>
                            Already in CRM
                          </Link>
                        ) : c.is_self ? (
                          <span style={{ color: 'var(--ink-muted)' }}>You</span>
                        ) : c.name_guessed && names[c.email] === c.name ? (
                          <span style={{ color: 'var(--state-warning)' }}>Name from address — research will confirm</span>
                        ) : c.personal_domain ? (
                          <span style={{ color: 'var(--ink-muted)' }}>Personal email</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {phase === 'progress' && (
          <div className="flex-1 overflow-y-auto">
            {research && rows.length > 0 && (
              <div className="h-0.5" style={{ background: 'var(--surface-sunken)' }}>
                <div className="h-full transition-all" style={{ width: `${(doneCount / rows.length) * 100}%`, background: 'var(--accent-primary)' }} />
              </div>
            )}
            <ul>
              {rows.map(r => (
                <li key={r.id} className="px-6 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                  <StatusMark status={r.enrichment_status} />
                  <div className="flex-1 min-w-0">
                    <Link href={`/partners/${r.id}`} className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>{r.name}</Link>
                    <div className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                      {[r.title, r.organization].filter(Boolean).join(' · ') || r.email}
                    </div>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: 'var(--ink-muted)' }}>{STATUS_LABEL[r.enrichment_status] ?? r.enrichment_status}</span>
                </li>
              ))}
            </ul>
            {skipped > 0 && (
              <p className="px-6 py-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {skipped} already in the CRM — skipped.
              </p>
            )}
          </div>
        )}

        <div className="px-6 py-3 flex items-center gap-3 shrink-0" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {error && <p className="text-xs flex-1" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          {phase === 'review' && !error && (
            <label className="flex items-center gap-2 text-xs flex-1" style={{ color: 'var(--ink-secondary)' }}>
              <input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)} />
              Research each contact online and fill in their profile
            </label>
          )}
          {phase === 'progress' && (
            <p className="text-xs flex-1" style={{ color: 'var(--ink-muted)' }}>
              {pendingIds.length > 0 ? 'You can close this — research keeps running in the background.' : 'All done.'}
            </p>
          )}
          <div className="flex gap-2 ml-auto">
            {phase === 'paste' && (
              <>
                <button onClick={close} className="text-sm px-4 py-1.5" style={secondaryBtn}>Cancel</button>
                <button onClick={handleParse} disabled={busy || !text.trim()} className="text-sm px-4 py-1.5 font-medium disabled:opacity-50" style={primaryBtn}>
                  {busy ? 'Reading…' : 'Find contacts'}
                </button>
              </>
            )}
            {phase === 'review' && (
              <>
                <button onClick={() => { setPhase('paste'); setError(null); }} className="text-sm px-4 py-1.5" style={secondaryBtn}>Back</button>
                <button onClick={handleCreate} disabled={busy || selected.size === 0} className="text-sm px-4 py-1.5 font-medium disabled:opacity-50" style={primaryBtn}>
                  {busy ? 'Adding…' : `Add ${selected.size} partner${selected.size !== 1 ? 's' : ''}`}
                </button>
              </>
            )}
            {phase === 'progress' && (
              <button onClick={close} className="text-sm px-4 py-1.5 font-medium" style={primaryBtn}>
                {pendingIds.length > 0 ? 'Close' : 'Done'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
