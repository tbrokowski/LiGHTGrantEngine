'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Mail, MoreHorizontal, X } from 'lucide-react';
import { partnerGroups, partners as partnersApi, partnerTasks } from '@/lib/api';
import AddPeopleModal from '@/components/crm/AddPeopleModal';
import GroupFormModal from '@/components/crm/GroupFormModal';
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
  stats: {
    members: number; engaged_30d: number; open_tasks: number; overdue_tasks: number; meetings_90d: number;
    next_meeting: { title: string; scheduled_at: string } | null; going_cold: number;
  };
  weekly: { touches: number; meetings: number }[];
  members: Member[];
  tasks: CrmTask[];
  activity: { kind: string; text: string; who: string | null; at: string; partner_id: string | null }[];
}

type Tab = 'overview' | 'members' | 'tasks';

function tint(color: string) {
  // Group color at low strength for light fills.
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}1F` : 'var(--surface-sunken)';
}

function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const [g, setG] = useState<GroupDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [memberFilter, setMemberFilter] = useState<'all' | 'cold' | 'p3'>('all');
  const [showAdd, setShowAdd] = useState(search.get('add') === '1');
  const [showEdit, setShowEdit] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menu, setMenu] = useState(false);

  const load = useCallback(() => {
    partnerGroups.get(id).then(r => setG(r.data)).catch(() => setMissing(true));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const members = useMemo(() => {
    if (!g) return [];
    const cold = (m: Member) => !m.last_touch || Date.now() - new Date(m.last_touch).getTime() >= 30 * 86_400_000;
    return g.members.filter(m => memberFilter === 'cold' ? cold(m) : memberFilter === 'p3' ? m.priority === 3 : true);
  }, [g, memberFilter]);

  async function toggleTask(t: CrmTask) {
    const status = t.status === 'done' ? 'open' : 'done';
    setG(prev => prev && { ...prev, tasks: prev.tasks.map(x => x.id === t.id ? { ...x, status } : x) });
    try { await partnerTasks.update(t.id, { status }); load(); } catch { load(); }
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

  async function deleteGroup() {
    await partnerGroups.remove(id);
    router.push('/partners');
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
  const s = g.stats;
  const engagedPct = s.members ? Math.round((100 * s.engaged_30d) / s.members) : 0;
  const maxWeek = Math.max(1, ...g.weekly.map(w => w.touches + w.meetings));
  const openTasks = g.tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const emails = g.members.map(m => m.email).filter(Boolean).join(',');

  const stats = [
    { label: 'Members', value: String(s.members), note: s.members === 1 ? '1 person' : `${s.members} people`, bar: null as number | null },
    { label: 'Contacted · 30 days', value: `${s.engaged_30d}/${s.members}`, note: `${engagedPct}% of the group`, bar: engagedPct },
    { label: 'Open tasks', value: String(s.open_tasks), note: s.overdue_tasks ? `${s.overdue_tasks} overdue` : 'none overdue', bar: null, danger: !!s.overdue_tasks },
    { label: 'Meetings · 90 days', value: String(s.meetings_90d), note: s.next_meeting ? `next ${new Date(s.next_meeting.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'none scheduled', bar: null },
    { label: 'Going cold', value: String(s.going_cold), note: 'no contact in 30+ days', bar: null, warn: !!s.going_cold },
  ];

  const memberTable = (
    <div style={card}>
      <div className="px-[18px] pt-4 pb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Members</h2>
        <div className="flex items-center gap-2">
          <Segmented label="Member filter" value={memberFilter} onChange={setMemberFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'cold', label: 'Going cold' }, { value: 'p3', label: 'Priority 3' }]} />
          <button type="button" onClick={() => setShowAdd(true)} className="h-[30px] px-2.5 text-xs font-medium" style={btnOutline}>+ Add people</button>
        </div>
      </div>
      <div className="grid gap-3 px-[18px] py-2" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.6fr) 64px minmax(0,1.1fr) 80px 24px', background: 'var(--surface-sunken)', borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}>
        <span className="ledger-label">Name</span><span className="ledger-label">Tags</span><span className="ledger-label">Priority</span>
        <span className="ledger-label">Last contact</span><span className="ledger-label">Open tasks</span><span />
      </div>
      {(tab === 'overview' ? members.slice(0, 10) : members).map(m => {
        const days = m.last_touch ? Math.floor((Date.now() - new Date(m.last_touch).getTime()) / 86_400_000) : null;
        const dot = days === null || days >= 30 ? 'var(--state-warning)' : days < 14 ? 'var(--state-success)' : 'var(--ink-faint)';
        return (
          <div key={m.id} className="group grid gap-3 px-[18px] py-2.5 items-center hover:bg-[var(--selection-bg)]"
            style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.6fr) 64px minmax(0,1.1fr) 80px 24px', borderBottom: '1px solid var(--rule-subtle)' }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={m.name} />
              <div className="min-w-0">
                <Link href={`/partners/${m.id}`} className="block text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{m.name}</Link>
                <span className="block text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{m.organization || m.email}</span>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">{m.tags.slice(0, 2).map(t => <TagPill key={t} label={t} />)}</div>
            <PriorityBars value={m.priority} onChange={p => setPriority(m.id, p)} />
            <span className="flex items-center gap-1.5 text-xs">
              <span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />
              <span className="mono-data" style={{ color: 'var(--ink-secondary)' }}>{sinceLabel(m.last_touch)}</span>
            </span>
            <span className="mono-data text-xs" style={{ color: 'var(--ink-secondary)' }}>{m.open_tasks || '—'}</span>
            <button type="button" onClick={() => removeMember(m.id)} aria-label={`Remove ${m.name} from the group`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100" style={{ color: 'var(--ink-muted)' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      {!members.length && (
        <p className="px-[18px] py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
          {g.members.length ? 'No one matches this filter.' : 'No one in this group yet — add people by tag or by name.'}
        </p>
      )}
      {tab === 'overview' && members.length > 10 && (
        <button type="button" onClick={() => setTab('members')} className="w-full px-[18px] py-3 text-left text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Showing 10 of {members.length} · <span className="underline" style={{ color: 'var(--ink-secondary)' }}>View all members</span>
        </button>
      )}
    </div>
  );

  const taskCard = (
    <div style={card}>
      <div className="px-[18px] pt-4 pb-2.5 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Group tasks</h2>
        <button type="button" onClick={() => setShowTask(true)} className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>+ Add</button>
      </div>
      <ul>
        {g.tasks.map(t => <TaskRow key={t.id} task={t} onToggle={toggleTask} showTarget={false} />)}
      </ul>
      {!g.tasks.length && (
        <p className="px-[18px] py-8 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
          No tasks yet. Tasks here belong to the whole group.
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--surface-base)' }}>
      <div className="px-7 pt-4 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <Link href="/partners" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--ink-muted)' }}>
          <ChevronLeft className="w-3 h-3" />Partners · Groups
        </Link>
        <div className="flex items-start gap-4 mt-3">
          <div className="w-12 h-12 rounded-[var(--radius-lg)] flex items-center justify-center text-base font-semibold shrink-0" style={{ background: color, color: 'var(--ink-inverse)' }}>
            {initials(g.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>{g.name}</h1>
            {g.description
              ? <p className="text-sm mt-1 max-w-2xl leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>{g.description}</p>
              : <button type="button" onClick={() => setShowEdit(true)} className="text-sm mt-1 underline" style={{ color: 'var(--ink-muted)' }}>Add a description</button>}
            {g.owner_name && <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>Created by <span style={{ color: 'var(--ink-secondary)' }}>{g.owner_name}</span></p>}
          </div>
          <div className="flex gap-2 relative">
            {emails && (
              <a href={`mailto:?bcc=${encodeURIComponent(emails)}`} className="h-9 px-3.5 text-[13px] flex items-center gap-2" style={btnQuiet}>
                <Mail className="w-3.5 h-3.5" />Email group
              </a>
            )}
            <button type="button" onClick={() => setShowAdd(true)} className="h-9 px-3.5 text-[13px] font-medium" style={btnOutline}>Add people</button>
            <button type="button" onClick={() => setShowTask(true)} className="h-9 px-3.5 text-[13px] font-medium" style={btnPrimary}>New task</button>
            <button type="button" onClick={() => setMenu(m => !m)} aria-label="More" aria-expanded={menu} className="h-9 w-9 flex items-center justify-center" style={btnQuiet}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-20 py-1 min-w-[160px]" style={{ ...card, boxShadow: 'var(--shadow-floating)' }}>
                <button type="button" onClick={() => { setMenu(false); setShowEdit(true); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-primary)' }}>Edit group</button>
                <button type="button" onClick={() => { setMenu(false); setConfirmDelete(true); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--state-danger)' }}>Delete group</button>
              </div>
            )}
          </div>
        </div>
        <div role="tablist" className="flex gap-6 mt-5 text-[13px]">
          {([['overview', 'Overview', null], ['members', 'Members', g.members.length], ['tasks', 'Tasks', openTasks.length]] as [Tab, string, number | null][]).map(([key, label, n]) => (
            <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)}
              className="py-2.5 -mb-px" style={{
                borderBottom: `2px solid ${tab === key ? 'var(--ink-primary)' : 'transparent'}`,
                color: tab === key ? 'var(--ink-primary)' : 'var(--ink-muted)', fontWeight: tab === key ? 600 : 400,
              }}>
              {label}{n !== null && <span className="mono-data ml-1">{n}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="px-7 py-6 flex flex-col gap-5">
        {tab === 'overview' && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {stats.map(st => (
                <div key={st.label} className="p-4" style={card}>
                  <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{st.label}</div>
                  <div className="mono-data text-[26px] font-medium mt-1.5" style={{ color: st.danger ? 'var(--state-danger)' : st.warn ? 'var(--state-warning)' : 'var(--ink-primary)' }}>{st.value}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>{st.note}</div>
                  {st.bar !== null && (
                    <div className="h-1 rounded-full mt-2.5 overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
                      <div className="h-full" style={{ width: `${st.bar}%`, background: color }} />
                    </div>
                  )}
                </div>
              ))}
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-8 flex flex-col gap-5">
                <div className="p-[18px]" style={card}>
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Engagement</h2>
                    <div className="flex gap-3.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                      <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />Emails &amp; calls</span>
                      <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: tint(color), border: `1px solid ${color}` }} />Meetings</span>
                    </div>
                  </div>
                  <div className="flex items-end gap-2.5 h-36 mt-4" style={{ borderBottom: '1px solid var(--rule-subtle)' }}
                    role="img" aria-label={`Weekly contact over 12 weeks: ${g.weekly.map(w => w.touches + w.meetings).join(', ')}`}>
                    {g.weekly.map((w, i) => (
                      <div key={i} className="flex-1 h-full flex flex-col justify-end" title={`${w.touches} touches, ${w.meetings} meetings`}>
                        {w.meetings > 0 && <div style={{ height: `${(w.meetings / maxWeek) * 100}%`, background: tint(color), borderTop: `1px solid ${color}`, borderRadius: '3px 3px 0 0' }} />}
                        {w.touches > 0 && <div style={{ height: `${(w.touches / maxWeek) * 100}%`, background: color, borderRadius: w.meetings ? 0 : '3px 3px 0 0' }} />}
                      </div>
                    ))}
                  </div>
                  <div className="mono-data flex justify-between text-[11px] mt-1.5" style={{ color: 'var(--ink-muted)' }}>
                    <span>{new Date(Date.now() - 11 * 7 * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span>This week</span>
                  </div>
                </div>
                {memberTable}
              </div>
              <div className="lg:col-span-4 flex flex-col gap-5">
                {taskCard}
                <div className="px-[18px] py-4" style={card}>
                  <h2 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-primary)' }}>Activity</h2>
                  {g.activity.map((a, i) => (
                    <div key={i} className="flex gap-2.5 py-2" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
                      <span className="mt-1.5 shrink-0" style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
                      <div className="min-w-0">
                        <div className="text-[13px] leading-snug break-words" style={{ color: 'var(--ink-secondary)' }}>{a.text}</div>
                        <div className="mono-data text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>{sinceLabel(a.at)}{a.who ? ` · ${a.who}` : ''}</div>
                      </div>
                    </div>
                  ))}
                  {!g.activity.length && <p className="text-xs py-3" style={{ color: 'var(--ink-muted)' }}>Nothing yet.</p>}
                </div>
              </div>
            </section>
          </>
        )}
        {tab === 'members' && memberTable}
        {tab === 'tasks' && <div className="max-w-3xl">{taskCard}</div>}
      </div>

      {showAdd && (
        <AddPeopleModal group={g} memberIds={g.members.map(m => m.id)} onClose={() => { setShowAdd(false); if (search.get('add')) router.replace(`/partners/groups/${id}`); }} onAdded={load} />
      )}
      {showEdit && <GroupFormModal group={g} onClose={() => setShowEdit(false)} onSaved={load} />}
      {showTask && <NewTaskModal target={{ kind: 'group', id: g.id, name: g.name, color: g.color }} onClose={() => setShowTask(false)} onCreated={load} />}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${g.name}?`}
          message="The group and its tasks are deleted. The people in it stay in your CRM."
          confirmLabel="Delete group"
          destructive
          onConfirm={deleteGroup}
          onCancel={() => setConfirmDelete(false)}
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
