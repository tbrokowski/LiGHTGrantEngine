'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, MoreHorizontal, Plus, X } from 'lucide-react';
import { partnerGroups, partners as partnersApi, partnerTasks } from '@/lib/api';
import AddPeopleModal from '@/components/crm/AddPeopleModal';
import GroupFormModal from '@/components/crm/GroupFormModal';
import LogMeetingModal from '@/components/crm/LogMeetingModal';
import NewTaskModal from '@/components/crm/NewTaskModal';
import TaskRow from '@/components/crm/TaskRow';
import ConfirmModal from '@/components/ui/ConfirmModal';
import {
  Avatar, CrmTask, PriorityBars, Segmented, TagPill, btnOutline, btnPrimary, btnQuiet, card, initials, sinceLabel,
} from '@/components/crm/crmUi';

interface Member {
  id: string; name: string; email?: string | null; organization?: string | null; title?: string | null;
  tags: string[]; priority: number; last_touch: string | null; open_tasks: number;
}

interface GroupDetail {
  id: string; name: string; description?: string | null; color?: string | null; owner_name?: string | null;
  weekly: { touches: number; meetings: number }[];
  members: Member[];
  tasks: CrmTask[];
  activity: { kind: string; text: string; who: string | null; at: string; partner_id: string | null }[];
}

type View = 'engagement' | 'tasks';

function tint(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}33` : 'var(--surface-sunken)';
}

const MEMBER_GRID = 'minmax(0,2fr) minmax(0,1.5fr) 64px minmax(0,1.1fr) 24px';

function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const [g, setG] = useState<GroupDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<View>(search.get('view') === 'tasks' ? 'tasks' : 'engagement');
  const [modal, setModal] = useState<null | 'add' | 'edit' | 'task' | 'log' | 'delete'>(search.get('add') === '1' ? 'add' : null);
  const [menu, setMenu] = useState(false);

  const load = useCallback(() => {
    partnerGroups.get(id).then(r => setG(r.data)).catch(() => setMissing(true));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  function switchView(v: View) {
    setView(v);
    router.replace(`/partners/groups/${id}${v === 'tasks' ? '?view=tasks' : ''}`, { scroll: false });
  }

  async function toggleTask(t: CrmTask) {
    const status = t.status === 'done' ? 'open' : 'done';
    setG(prev => prev && { ...prev, tasks: prev.tasks.map(x => x.id === t.id ? { ...x, status } : x) });
    try { await partnerTasks.update(t.id, { status }); } finally { load(); }
  }

  async function setPriority(pid: string, p: number) {
    setG(prev => prev && { ...prev, members: prev.members.map(m => m.id === pid ? { ...m, priority: p } : m) });
    await partnersApi.update(pid, { priority: p }).catch(load);
  }

  async function removeMember(pid: string) {
    setG(prev => prev && { ...prev, members: prev.members.filter(m => m.id !== pid) });
    await partnerGroups.removeMember(id, pid).catch(() => {});
    load();
  }

  if (missing) {
    return (
      <div className="px-8 py-16 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        <p>This group doesn’t exist or was deleted.</p>
        <Link href="/partners" className="underline mt-3 inline-block" style={{ color: 'var(--ink-secondary)' }}>Back to Partners</Link>
      </div>
    );
  }
  if (!g) return <div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>;

  const color = g.color || 'var(--ink-muted)';
  const maxWeek = Math.max(1, ...g.weekly.map(w => w.touches + w.meetings));
  const totalTouches = g.weekly.reduce((a, w) => a + w.touches, 0);
  const totalMeetings = g.weekly.reduce((a, w) => a + w.meetings, 0);
  const openTasks = g.tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length;
  const emails = g.members.map(m => m.email).filter(Boolean).join(',');

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--surface-base)' }}>
      <div className="px-7 pt-4 pb-4 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <Link href="/partners" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--ink-muted)' }}>
          <ChevronLeft className="w-3 h-3" />Partners · Groups
        </Link>
        <div className="flex items-start gap-4 mt-3">
          <div className="w-12 h-12 rounded-[var(--radius-lg)] flex items-center justify-center text-base font-semibold shrink-0" style={{ background: color, color: 'var(--ink-inverse)' }}>
            {initials(g.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>{g.name}</h1>
            <p className="text-sm mt-1 max-w-2xl leading-relaxed" style={{ color: g.description ? 'var(--ink-secondary)' : 'var(--ink-muted)' }}>
              {g.description || <button type="button" onClick={() => setModal('edit')} className="underline">Add a description</button>}
            </p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>
              <span className="mono-data">{g.members.length}</span> {g.members.length === 1 ? 'person' : 'people'}
              {g.owner_name && <> · created by <span style={{ color: 'var(--ink-secondary)' }}>{g.owner_name}</span></>}
            </p>
          </div>
          <div className="flex gap-2 relative">
            <button type="button" onClick={() => setModal('add')} className="h-9 px-3.5 text-[13px] font-medium" style={btnOutline}>Add people</button>
            <button type="button" onClick={() => setModal('log')} disabled={!g.members.length} className="h-9 px-3.5 text-[13px] font-medium disabled:opacity-40" style={btnPrimary}>
              Log meeting
            </button>
            <button type="button" onClick={() => setMenu(m => !m)} aria-label="More" aria-expanded={menu} className="h-9 w-9 flex items-center justify-center" style={btnQuiet}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-20 py-1 min-w-[170px]" style={{ ...card, boxShadow: 'var(--shadow-floating)' }} onMouseLeave={() => setMenu(false)}>
                {emails && (
                  <a href={`mailto:?bcc=${encodeURIComponent(emails)}`} className="block px-3 py-2 text-[13px] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-primary)' }}>Email everyone</a>
                )}
                <button type="button" onClick={() => { setMenu(false); setModal('edit'); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-primary)' }}>Edit group</button>
                <button type="button" onClick={() => { setMenu(false); setModal('delete'); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--state-danger)' }}>Delete group</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-7 py-5 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <Segmented label="View" value={view} onChange={switchView}
            options={[{ value: 'engagement', label: 'Engagement' }, { value: 'tasks', label: `Tasks${openTasks ? ` · ${openTasks}` : ''}` }]} />
          {view === 'tasks' && (
            <button type="button" onClick={() => setModal('task')} className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium" style={btnPrimary}>
              <Plus className="w-3.5 h-3.5" />New task
            </button>
          )}
        </div>

        {view === 'engagement' && (
          <>
            <div className="p-[18px]" style={card}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Team touches</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    <span className="mono-data">{totalTouches}</span> emails &amp; calls · <span className="mono-data">{totalMeetings}</span> meetings in the last 12 weeks
                  </p>
                </div>
                <div className="flex gap-3.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />Emails &amp; calls</span>
                  <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: tint(color), border: `1px solid ${color}` }} />Meetings</span>
                </div>
              </div>
              <div className="flex items-end gap-2.5 h-36 mt-4" style={{ borderBottom: '1px solid var(--rule-subtle)' }}
                role="img" aria-label={`Weekly contact over 12 weeks: ${g.weekly.map(w => w.touches + w.meetings).join(', ')}`}>
                {g.weekly.map((w, i) => (
                  <div key={i} className="flex-1 h-full flex flex-col justify-end" title={`${w.touches} emails & calls, ${w.meetings} meetings`}>
                    {w.meetings > 0 && <div style={{ height: `${(w.meetings / maxWeek) * 100}%`, background: tint(color), borderTop: `1px solid ${color}`, borderRadius: '3px 3px 0 0' }} />}
                    {w.touches > 0 && <div style={{ height: `${(w.touches / maxWeek) * 100}%`, background: color, borderRadius: w.meetings ? 0 : '3px 3px 0 0' }} />}
                  </div>
                ))}
              </div>
              <div className="mono-data flex justify-between text-[11px] mt-1.5" style={{ color: 'var(--ink-muted)' }}>
                <span>{new Date(Date.now() - 11 * 7 * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span>This week</span>
              </div>
            </div>

            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-8" style={card}>
                <div className="px-[18px] pt-4 pb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>People</h2>
                  <button type="button" onClick={() => setModal('add')} className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>+ Add people</button>
                </div>
                <div className="grid gap-3 px-[18px] py-2" style={{ gridTemplateColumns: MEMBER_GRID, background: 'var(--surface-sunken)', borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}>
                  <span className="ledger-label">Name</span><span className="ledger-label">Tags</span><span className="ledger-label">Priority</span>
                  <span className="ledger-label">Last contact</span><span />
                </div>
                {g.members.map(m => {
                  const days = m.last_touch ? Math.floor((Date.now() - new Date(m.last_touch).getTime()) / 86_400_000) : null;
                  const dot = days === null || days >= 30 ? 'var(--state-warning)' : days < 14 ? 'var(--state-success)' : 'var(--ink-faint)';
                  return (
                    <div key={m.id} className="group grid gap-3 px-[18px] py-2.5 items-center hover:bg-[var(--selection-bg)]"
                      style={{ gridTemplateColumns: MEMBER_GRID, borderBottom: '1px solid var(--rule-subtle)' }}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={m.name} />
                        <div className="min-w-0">
                          <Link href={`/partners/${m.id}`} className="block text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{m.name}</Link>
                          <span className="block text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{m.organization || m.email}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 min-w-0 overflow-hidden" title={m.tags.join(', ')}>{m.tags.slice(0, 2).map(t => <TagPill key={t} label={t} />)}</div>
                      <PriorityBars value={m.priority} onChange={p => setPriority(m.id, p)} />
                      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />
                        <span className="mono-data" style={{ color: 'var(--ink-secondary)' }}>{sinceLabel(m.last_touch)}</span>
                      </span>
                      <button type="button" onClick={() => removeMember(m.id)} aria-label={`Remove ${m.name} from the group`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100" style={{ color: 'var(--ink-muted)' }}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {!g.members.length && (
                  <p className="px-[18px] py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>No one in this group yet — add people by tag or by name.</p>
                )}
              </div>

              <div className="lg:col-span-4 px-[18px] py-4 self-start" style={card}>
                <div className="flex items-center justify-between mb-1.5">
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Activity</h2>
                  <button type="button" onClick={() => setModal('log')} disabled={!g.members.length} className="text-xs font-medium disabled:opacity-40" style={{ color: 'var(--ink-secondary)' }}>+ Log meeting</button>
                </div>
                {g.activity.map((a, i) => (
                  <div key={i} className="flex gap-2.5 py-2" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
                    <span className="mt-1.5 shrink-0" style={{ width: 6, height: 6, borderRadius: 999, background: a.kind === 'meeting' ? color : 'var(--rule-strong)' }} />
                    <div className="min-w-0">
                      <div className="text-[13px] leading-snug break-words" style={{ color: 'var(--ink-secondary)' }}>{a.text}</div>
                      <div className="mono-data text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>{sinceLabel(a.at)}{a.who ? ` · ${a.who}` : ''}</div>
                    </div>
                  </div>
                ))}
                {!g.activity.length && <p className="text-xs py-3" style={{ color: 'var(--ink-muted)' }}>Nothing logged yet.</p>}
              </div>
            </section>
          </>
        )}

        {view === 'tasks' && (
          <div style={card}>
            <ul>
              {g.tasks.map(t => <TaskRow key={t.id} task={t} onToggle={toggleTask} showTarget={false} />)}
            </ul>
            {!g.tasks.length && (
              <p className="px-[18px] py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
                No tasks yet. Tasks here belong to the whole group.
              </p>
            )}
          </div>
        )}
      </div>

      {modal === 'add' && (
        <AddPeopleModal group={g} memberIds={g.members.map(m => m.id)}
          onClose={() => { setModal(null); if (search.get('add')) router.replace(`/partners/groups/${id}`); }} onAdded={load} />
      )}
      {modal === 'edit' && <GroupFormModal group={g} onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'task' && <NewTaskModal target={{ kind: 'group', id: g.id, name: g.name, color: g.color }} onClose={() => setModal(null)} onCreated={load} />}
      {modal === 'log' && <LogMeetingModal group={g} members={g.members} onClose={() => setModal(null)} onLogged={load} />}
      {modal === 'delete' && (
        <ConfirmModal
          title={`Delete ${g.name}?`}
          message="The group and its tasks are deleted. The people in it stay in your CRM."
          confirmLabel="Delete group"
          destructive
          onConfirm={async () => { await partnerGroups.remove(id); router.push('/partners'); }}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}

export default function GroupPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}>
      <GroupPage />
    </Suspense>
  );
}
