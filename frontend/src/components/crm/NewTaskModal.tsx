'use client';
import { useEffect, useState } from 'react';
import { partners as partnersApi, partnerGroups, partnerTasks, users as usersApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import CrmModal, { fieldStyle, errDetail } from './CrmModal';
import { GroupRef, btnPrimary, btnQuiet } from './crmUi';

type Target = { kind: 'partner' | 'group'; id: string; name: string; color?: string | null };

interface Member { id: string; name: string }

/**
 * Create a task on a person or a group. Pass `target` to fix what it's for
 * (from a person or group page); otherwise the user picks one.
 */
export default function NewTaskModal({
  target: fixedTarget, onClose, onCreated,
}: { target?: Target; onClose: () => void; onCreated: () => void }) {
  const { user } = useAuth();
  const [target, setTarget] = useState<Target | null>(fixedTarget ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string>(user?.id ?? '');
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Target search
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; organization?: string }[]>([]);

  useEffect(() => { usersApi.list().then(r => setMembers(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { if (user?.id && !assignee) setAssignee(user.id); }, [user?.id, assignee]);
  useEffect(() => {
    if (fixedTarget) return;
    partnerGroups.list().then(r => setGroups(r.data || [])).catch(() => {});
  }, [fixedTarget]);
  useEffect(() => {
    if (fixedTarget || target) return;
    const t = setTimeout(() => {
      partnersApi.list({ q: q || undefined, limit: 8, sort_by: 'priority', sort_dir: 'desc' })
        .then(r => setPeople(r.data || [])).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, fixedTarget, target]);

  const shownGroups = groups.filter(g => !q || g.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5);

  async function save() {
    if (!target || !title.trim()) return;
    setBusy(true);
    setError(null);
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      due_date: due ? new Date(`${due}T12:00:00`).toISOString() : undefined,
      assigned_to: assignee || undefined,
    };
    try {
      if (target.kind === 'group') await partnerGroups.createTask(target.id, body);
      else await partnerTasks.create({ ...body, partner_id: target.id });
      onCreated();
      onClose();
    } catch (err) {
      setError(errDetail(err, 'Couldn’t create the task.'));
    } finally { setBusy(false); }
  }

  return (
    <CrmModal
      title="New task"
      subtitle={target ? `For ${target.kind === 'group' ? 'the group' : ''} ${target.name}` : 'For a person or a group'}
      onClose={onClose}
      accent={target?.kind === 'group' ? target.color : undefined}
      footer={
        <>
          {error && <p className="text-xs flex-1" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="text-sm px-4 h-9" style={btnQuiet}>Cancel</button>
            <button type="button" onClick={save} disabled={busy || !target || !title.trim()} className="text-sm px-4 h-9 font-medium disabled:opacity-40" style={btnPrimary}>
              {busy ? 'Saving…' : 'Create task'}
            </button>
          </div>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        {!fixedTarget && (
          <div>
            <label className="ledger-label block mb-1.5" htmlFor="task-target">For</label>
            {target ? (
              <div className="flex items-center gap-2 px-3 h-9 text-sm" style={fieldStyle}>
                {target.kind === 'group'
                  ? <span style={{ width: 8, height: 8, borderRadius: 2, background: target.color || 'var(--ink-muted)' }} />
                  : <span style={{ width: 8, height: 8, borderRadius: 999, border: '1.5px solid var(--ink-muted)' }} />}
                <span className="flex-1">{target.name}</span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{target.kind === 'group' ? 'Group' : 'Person'}</span>
                <button type="button" onClick={() => setTarget(null)} className="text-xs underline" style={{ color: 'var(--ink-secondary)' }}>Change</button>
              </div>
            ) : (
              <>
                <input
                  id="task-target" autoFocus value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search a person or group…" className="w-full px-3 h-9 text-sm" style={fieldStyle}
                />
                <div className="mt-2 max-h-56 overflow-y-auto" style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)' }}>
                  {shownGroups.map(g => (
                    <button key={g.id} type="button" onClick={() => setTarget({ kind: 'group', id: g.id, name: g.name, color: g.color })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--surface-sunken)]" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color || 'var(--ink-muted)' }} />
                      <span className="flex-1">{g.name}</span>
                      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Group</span>
                    </button>
                  ))}
                  {people.map(p => (
                    <button key={p.id} type="button" onClick={() => setTarget({ kind: 'partner', id: p.id, name: p.name })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--surface-sunken)]" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, border: '1.5px solid var(--ink-muted)' }} />
                      <span className="flex-1">{p.name}</span>
                      <span className="text-xs truncate max-w-[200px]" style={{ color: 'var(--ink-muted)' }}>{p.organization || 'Person'}</span>
                    </button>
                  ))}
                  {!shownGroups.length && !people.length && (
                    <p className="px-3 py-4 text-xs text-center" style={{ color: 'var(--ink-muted)' }}>No matches.</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <label className="ledger-label block mb-1.5" htmlFor="task-title">Task</label>
          <input id="task-title" autoFocus={!!fixedTarget} value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            placeholder="e.g. Send the budget template" className="w-full px-3 h-9 text-sm" style={fieldStyle} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ledger-label block mb-1.5" htmlFor="task-due">Due date</label>
            <input id="task-due" type="date" value={due} onChange={e => setDue(e.target.value)} className="w-full px-3 h-9 text-sm" style={fieldStyle} />
          </div>
          <div>
            <label className="ledger-label block mb-1.5" htmlFor="task-assignee">Assigned to</label>
            <select id="task-assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className="w-full px-2 h-9 text-sm" style={fieldStyle}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.id === user?.id ? `${m.name} (me)` : m.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="ledger-label block mb-1.5" htmlFor="task-notes">Notes</label>
          <textarea id="task-notes" rows={3} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Optional details" className="w-full px-3 py-2 text-sm resize-none" style={fieldStyle} />
        </div>
      </div>
    </CrmModal>
  );
}
