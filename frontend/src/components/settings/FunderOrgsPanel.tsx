'use client';

import { useEffect, useState } from 'react';
import { funderOrgs, opportunities } from '@/lib/api';

interface FunderOrg {
  id: string;
  name: string;
  url: string | null;
  notes: string | null;
  deadline_info: string | null;
}

const FIELD_CLS =
  'w-full border rounded-md px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-1';

export function FunderOrgsPanel() {
  const [orgs, setOrgs] = useState<FunderOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newDeadlineInfo, setNewDeadlineInfo] = useState('');
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editDraft, setEditDraft] = useState<Record<string, Partial<FunderOrg>>>({});
  const [savingEdit, setSavingEdit] = useState<string | null>(null);

  function fetchOrgs() {
    setLoading(true);
    funderOrgs.list().then(r => setOrgs(r.data ?? [])).finally(() => setLoading(false));
  }

  useEffect(() => { fetchOrgs(); }, []);

  async function handleFetchPreview() {
    if (!newUrl.trim()) return;
    setFetching(true);
    try {
      const { data } = await opportunities.scrapePreview(newUrl.trim());
      if (data.short_summary && !newNotes) setNewNotes(data.short_summary);
    } catch {
      // non-fatal — user can still fill in notes manually
    } finally {
      setFetching(false);
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await funderOrgs.create({
        name: newName.trim(),
        url: newUrl.trim() || null,
        notes: newNotes.trim() || null,
        deadline_info: newDeadlineInfo.trim() || null,
      });
      setNewName(''); setNewUrl(''); setNewNotes(''); setNewDeadlineInfo('');
      setShowAdd(false);
      fetchOrgs();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(id: string) {
    const draft = editDraft[id];
    if (!draft) return;
    setSavingEdit(id);
    try {
      await funderOrgs.update(id, draft);
      setExpandedId(null);
      setEditDraft(prev => { const n = { ...prev }; delete n[id]; return n; });
      fetchOrgs();
    } finally {
      setSavingEdit(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this funder org? Opportunities linked to it will keep their other data but lose this link.')) return;
    await funderOrgs.delete(id);
    fetchOrgs();
  }

  function startEdit(org: FunderOrg) {
    setExpandedId(org.id);
    setEditDraft(prev => ({ ...prev, [org.id]: { name: org.name, url: org.url ?? '', notes: org.notes ?? '', deadline_info: org.deadline_info ?? '' } }));
  }

  return (
    <div className="mb-8">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Funder Organizations</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            The actual funding bodies (e.g. Fulbright) — distinct from scraper portals above. Usually manually
            tracked since these are hard to scrape.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
          style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
        >
          {showAdd ? 'Cancel' : '+ Add Funder Org'}
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-3 rounded-md space-y-2" style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
          <input placeholder="Name (required)" value={newName} onChange={e => setNewName(e.target.value)} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} />
          <div className="flex gap-2">
            <input placeholder="URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} />
            <button
              type="button"
              onClick={handleFetchPreview}
              disabled={!newUrl.trim() || fetching}
              className="shrink-0 px-3 py-1.5 text-xs rounded-md border disabled:opacity-40 whitespace-nowrap"
              style={{ borderColor: 'var(--rule-subtle)', color: 'var(--ink-muted)' }}
            >
              {fetching ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          <textarea placeholder="Notes" value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} />
          <input placeholder="Deadline info (e.g. Rounds open Feb/Jun/Oct)" value={newDeadlineInfo} onChange={e => setNewDeadlineInfo(e.target.value)} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} />
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-white disabled:opacity-40"
            style={{ background: 'var(--ink-primary)' }}
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
      ) : orgs.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>No funder orgs added yet.</p>
      ) : (
        <div className="divide-y" style={{ borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}>
          {orgs.map(org => {
            const isExpanded = expandedId === org.id;
            const draft = editDraft[org.id];
            return (
              <div key={org.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--ink-primary)' }}>{org.name}</p>
                    {org.deadline_info && <p className="text-xs truncate" style={{ color: 'var(--ink-faint)' }}>{org.deadline_info}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => isExpanded ? setExpandedId(null) : startEdit(org)} className="text-xs px-2 py-1 rounded-md border" style={{ borderColor: 'var(--rule-subtle)', color: 'var(--ink-muted)' }}>
                      {isExpanded ? 'Close' : 'Edit'}
                    </button>
                    <button onClick={() => handleDelete(org.id)} className="text-xs px-2 py-1 rounded-md border" style={{ borderColor: 'var(--state-danger)', color: 'var(--state-danger)' }}>
                      Delete
                    </button>
                  </div>
                </div>
                {isExpanded && draft && (
                  <div className="mt-2 space-y-2">
                    <input value={draft.name ?? ''} onChange={e => setEditDraft(p => ({ ...p, [org.id]: { ...p[org.id], name: e.target.value } }))} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} placeholder="Name" />
                    <input value={draft.url ?? ''} onChange={e => setEditDraft(p => ({ ...p, [org.id]: { ...p[org.id], url: e.target.value } }))} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} placeholder="URL" />
                    <textarea value={draft.notes ?? ''} onChange={e => setEditDraft(p => ({ ...p, [org.id]: { ...p[org.id], notes: e.target.value } }))} rows={2} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} placeholder="Notes" />
                    <input value={draft.deadline_info ?? ''} onChange={e => setEditDraft(p => ({ ...p, [org.id]: { ...p[org.id], deadline_info: e.target.value } }))} className={FIELD_CLS} style={{ borderColor: 'var(--rule-subtle)' }} placeholder="Deadline info" />
                    <button
                      onClick={() => handleSaveEdit(org.id)}
                      disabled={savingEdit === org.id}
                      className="px-3 py-1.5 text-xs font-medium rounded-md text-white disabled:opacity-40"
                      style={{ background: 'var(--ink-primary)' }}
                    >
                      {savingEdit === org.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
