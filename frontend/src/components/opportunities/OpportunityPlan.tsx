'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { opportunities, organizations } from '@/lib/api';
import { formatDate, type OppWorkspace, type OppTask, type OppNote, type OppLink } from './types';

interface Member { id: string; name?: string | null; email: string; }

interface Props {
  opportunityId: string;
  /** show the Team/My toggle (org users only) and default to Team when on org shortlist */
  canUseOrg: boolean;
  defaultScope: 'user' | 'org';
  institutionId?: string | null;
}

const EMPTY: OppWorkspace = {
  scope: 'user', tasks: [], notes: [], links: [],
  call_dates: { deadline: null, loi_deadline: null, concept_note_deadline: null, full_proposal_deadline: null },
};

function initials(m?: Member): string {
  const s = (m?.name || m?.email || '?').trim();
  const parts = s.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Small section wrapper with a light header + count */
function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {title}{typeof count === 'number' && count > 0 && <span className="ml-1.5 text-gray-400 font-normal">{count}</span>}
        </h3>
        {action}
      </div>
      <div className="px-5 pb-4">{children}</div>
    </div>
  );
}

export default function OpportunityPlan({ opportunityId, canUseOrg, defaultScope, institutionId }: Props) {
  const [scope, setScope] = useState<'user' | 'org'>(canUseOrg ? defaultScope : 'user');
  const [ws, setWs] = useState<OppWorkspace>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);

  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  const load = useCallback(() => {
    setLoading(true);
    opportunities.workspace(opportunityId, scope)
      .then(r => setWs(r.data))
      .catch(() => setWs(EMPTY))
      .finally(() => setLoading(false));
  }, [opportunityId, scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!institutionId) return;
    organizations.members(institutionId).then(r => setMembers(r.data)).catch(() => setMembers([]));
  }, [institutionId]);

  // ── mutations (optimistic-ish: reload after write) ──────────────────────────
  async function addTask(fields: { title: string; due_date?: string; assignee_ids: string[] }) {
    await opportunities.createOppTask(opportunityId, { scope, ...fields });
    load();
  }
  async function patchTask(t: OppTask, data: Record<string, unknown>) {
    setWs(w => ({ ...w, tasks: w.tasks.map(x => x.id === t.id ? { ...x, ...data } as OppTask : x) }));
    await opportunities.updateOppTask(opportunityId, t.id, data);
  }
  async function removeTask(t: OppTask) {
    setWs(w => ({ ...w, tasks: w.tasks.filter(x => x.id !== t.id) }));
    await opportunities.deleteOppTask(opportunityId, t.id);
  }
  async function addNote(body: string) { await opportunities.createOppNote(opportunityId, { scope, body }); load(); }
  async function removeNote(n: OppNote) {
    setWs(w => ({ ...w, notes: w.notes.filter(x => x.id !== n.id) }));
    await opportunities.deleteOppNote(opportunityId, n.id);
  }
  async function addLink(label: string, url: string) { await opportunities.createOppLink(opportunityId, { scope, label, url }); load(); }
  async function removeLink(l: OppLink) {
    setWs(w => ({ ...w, links: w.links.filter(x => x.id !== l.id) }));
    await opportunities.deleteOppLink(opportunityId, l.id);
  }

  const keyDates = useMemo(() => {
    const cd = ws.call_dates;
    const rows: { label: string; date: string }[] = [];
    if (cd.loi_deadline) rows.push({ label: 'LOI', date: cd.loi_deadline });
    if (cd.concept_note_deadline) rows.push({ label: 'Concept note', date: cd.concept_note_deadline });
    if (cd.full_proposal_deadline) rows.push({ label: 'Full proposal', date: cd.full_proposal_deadline });
    if (cd.deadline) rows.push({ label: 'Deadline', date: cd.deadline });
    for (const t of ws.tasks) if (t.due_date) rows.push({ label: t.title, date: t.due_date });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [ws]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Plan</h2>
        {canUseOrg && (
          <div className="flex items-center rounded-md overflow-hidden border border-gray-200 text-xs">
            {(['user', 'org'] as const).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-2.5 py-1 font-medium transition-colors ${scope === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {s === 'user' ? 'My plan' : 'Team plan'}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          <TasksSection
            tasks={ws.tasks}
            members={members}
            memberById={memberById}
            onAdd={addTask}
            onPatch={patchTask}
            onRemove={removeTask}
          />

          {keyDates.length > 0 && (
            <Section title="Key dates" count={keyDates.length}>
              <ul className="space-y-1.5">
                {keyDates.map((d, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate pr-3">{d.label}</span>
                    <span className="text-xs font-mono text-gray-500 shrink-0">{formatDate(d.date)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <NotesSection notes={ws.notes} memberById={memberById} onAdd={addNote} onRemove={removeNote} />
          <LinksSection links={ws.links} onAdd={addLink} onRemove={removeLink} />
        </>
      )}
    </div>
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
function TasksSection({ tasks, members, memberById, onAdd, onPatch, onRemove }: {
  tasks: OppTask[];
  members: Member[];
  memberById: Map<string, Member>;
  onAdd: (f: { title: string; due_date?: string; assignee_ids: string[] }) => void;
  onPatch: (t: OppTask, data: Record<string, unknown>) => void;
  onRemove: (t: OppTask) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);

  function submit() {
    if (!title.trim()) { setAdding(false); return; }
    onAdd({ title: title.trim(), due_date: due || undefined, assignee_ids: assignees });
    setTitle(''); setDue(''); setAssignees([]); setAdding(false);
  }

  return (
    <Section
      title="Tasks"
      count={tasks.length}
      action={
        <button onClick={() => setAdding(a => !a)} className="text-xs font-medium text-blue-600 hover:text-blue-700">
          + Add task
        </button>
      }
    >
      {adding && (
        <div className="mb-3 p-2.5 rounded-md border border-gray-200 bg-gray-50 space-y-2">
          <input
            autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Task title" className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={due} onChange={e => setDue(e.target.value)} className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-600" />
            {members.length > 0 && (
              <select
                value="" onChange={e => { if (e.target.value && !assignees.includes(e.target.value)) setAssignees([...assignees, e.target.value]); }}
                className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-600"
              >
                <option value="">+ Assignee…</option>
                {members.filter(m => !assignees.includes(m.id)).map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
            )}
            {assignees.map(id => (
              <span key={id} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full pl-1.5 pr-1 py-0.5">
                {(memberById.get(id)?.name || memberById.get(id)?.email || '?')}
                <button onClick={() => setAssignees(assignees.filter(a => a !== id))} className="text-gray-400 hover:text-gray-700">×</button>
              </span>
            ))}
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setAdding(false)} className="text-xs px-2 py-1 text-gray-500">Cancel</button>
              <button onClick={submit} className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white font-medium">Add</button>
            </div>
          </div>
        </div>
      )}

      {tasks.length === 0 && !adding ? (
        <p className="text-sm text-gray-400">No tasks yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map(t => {
            const done = t.status === 'done';
            return (
              <li key={t.id} className="group flex items-start gap-2.5">
                <button
                  onClick={() => onPatch(t, { status: done ? 'open' : 'done' })}
                  className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${done ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 hover:border-blue-400'}`}
                  title={done ? 'Mark open' : 'Mark done'}
                >
                  {done && <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{t.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {t.due_date && <span className="text-[11px] font-mono text-gray-500">{formatDate(t.due_date)}</span>}
                    {t.due_date && (t.remind_days_before?.length ?? 0) > 0 && (
                      <span className="text-[11px] text-gray-400" title={`Reminders: ${t.remind_days_before.join(', ')} days before`}>🔔</span>
                    )}
                    {t.assignee_ids.length > 0 && (
                      <span className="flex -space-x-1">
                        {t.assignee_ids.slice(0, 3).map(id => (
                          <span key={id} title={memberById.get(id)?.name || memberById.get(id)?.email || id}
                            className="w-4 h-4 rounded-full bg-gray-200 text-[8px] font-semibold text-gray-600 flex items-center justify-center border border-white">
                            {initials(memberById.get(id))}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => onRemove(t)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 text-sm shrink-0" title="Delete">×</button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────
function NotesSection({ notes, memberById, onAdd, onRemove }: {
  notes: OppNote[];
  memberById: Map<string, Member>;
  onAdd: (body: string) => void;
  onRemove: (n: OppNote) => void;
}) {
  const [body, setBody] = useState('');
  return (
    <Section title="Notes" count={notes.length}>
      <div className="flex gap-2 mb-2.5">
        <textarea
          value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="Add a note…"
          className="flex-1 text-sm px-2.5 py-1.5 border border-gray-200 rounded resize-none"
        />
        <button
          onClick={() => { if (body.trim()) { onAdd(body.trim()); setBody(''); } }}
          disabled={!body.trim()}
          className="text-xs px-3 rounded bg-blue-600 text-white font-medium disabled:opacity-40 shrink-0"
        >Add</button>
      </div>
      <ul className="space-y-2">
        {notes.map(n => (
          <li key={n.id} className="group text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded p-2.5 whitespace-pre-wrap">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">{n.body}</span>
              <button onClick={() => onRemove(n)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0" title="Delete">×</button>
            </div>
            <div className="text-[11px] text-gray-400 mt-1">
              {memberById.get(n.created_by_id ?? '')?.name || memberById.get(n.created_by_id ?? '')?.email || ''} {n.created_at ? `· ${formatDate(n.created_at)}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── Links ─────────────────────────────────────────────────────────────────────
function LinksSection({ links, onAdd, onRemove }: {
  links: OppLink[];
  onAdd: (label: string, url: string) => void;
  onRemove: (l: OppLink) => void;
}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  function submit() {
    if (!label.trim() || !url.trim()) return;
    onAdd(label.trim(), url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    setLabel(''); setUrl('');
  }
  return (
    <Section title="Links" count={links.length}>
      <div className="flex gap-2 mb-2.5">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" className="w-32 text-sm px-2 py-1.5 border border-gray-200 rounded" />
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} placeholder="https://…" className="flex-1 text-sm px-2 py-1.5 border border-gray-200 rounded" />
        <button onClick={submit} disabled={!label.trim() || !url.trim()} className="text-xs px-3 rounded bg-blue-600 text-white font-medium disabled:opacity-40 shrink-0">Add</button>
      </div>
      <ul className="space-y-1">
        {links.map(l => (
          <li key={l.id} className="group flex items-center justify-between text-sm">
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate pr-3">{l.label} ↗</a>
            <button onClick={() => onRemove(l)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0" title="Delete">×</button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
