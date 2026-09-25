'use client';
// Top half of the Partners home: headline numbers, my tasks, reach-out
// suggestions, and this week (meetings + team activity).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { partners as partnersApi, partnerTasks } from '@/lib/api';
import { Avatar, CrmTask, Segmented, card, btnPrimary, btnQuiet } from '../crmUi';
import TaskRow from '../TaskRow';
import { fieldStyle } from '../CrmModal';

export interface HomeData {
  counts: { people: number; groups: number };
  kpis: {
    open_tasks: number; my_open_tasks: number; overdue: number; my_overdue: number;
    touches_30d: number; touches_prev_30d: number; going_cold: number; meetings_week: number;
  };
  weekly_touches: number[];
  suggestions: Suggestion[];
  meetings: { id: string; partner_id: string; partner_name: string; title: string; scheduled_at: string; attendee_count: number }[];
}

interface Suggestion {
  partner_id: string; name: string; organization?: string | null; priority: number;
  kind: 'followup' | 'task' | 'slipping' | 'cold'; reason: string;
}

// ── Pulse strip ────────────────────────────────────────────────────────────────

export function PulseStrip({ data }: { data: HomeData | null }) {
  const k = data?.kpis;
  const delta = k && k.touches_prev_30d
    ? `${k.touches_30d >= k.touches_prev_30d ? '+' : ''}${Math.round(((k.touches_30d - k.touches_prev_30d) / k.touches_prev_30d) * 100)}% vs prior 30`
    : 'last 30 days';
  const cells: { label: string; value: string; note: string; color?: string }[] = [
    { label: 'Open tasks', value: k ? String(k.open_tasks) : '–', note: k ? `${k.my_open_tasks} mine` : '' },
    { label: 'Overdue', value: k ? String(k.overdue) : '–', note: k ? `${k.my_overdue} mine` : '', color: k?.overdue ? 'var(--state-danger)' : undefined },
    { label: 'Touches · 30 days', value: k ? String(k.touches_30d) : '–', note: delta },
    { label: 'Going cold', value: k ? String(k.going_cold) : '–', note: 'P2–P3 past their usual gap', color: k?.going_cold ? 'var(--state-warning)' : undefined },
    { label: 'Meetings · next 7 days', value: k ? String(k.meetings_week) : '–', note: data?.meetings[0] ? `next ${new Date(data.meetings[0].scheduled_at).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}` : 'none scheduled' },
  ];
  return (
    <section aria-label="Pulse" className="grid grid-cols-2 md:grid-cols-5" style={card}>
      {cells.map((c, i) => (
        <div key={c.label} className="px-[18px] py-3.5" style={{ borderLeft: i ? '1px solid var(--rule-subtle)' : undefined }}>
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{c.label}</div>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="mono-data text-2xl font-medium" style={{ color: c.color || 'var(--ink-primary)' }}>{c.value}</span>
            <span className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{c.note}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

// ── My tasks ──────────────────────────────────────────────────────────────────

export function MyTasksCard({ refreshKey, onNewTask, onChanged }: { refreshKey: number; onNewTask: () => void; onChanged: () => void }) {
  const [scope, setScope] = useState<'mine' | 'team' | 'unassigned'>('mine');
  const [tasks, setTasks] = useState<CrmTask[] | null>(null);

  const load = useCallback(() => {
    partnerTasks.list({ scope, include_done: true, limit: 8 }).then(r => setTasks(r.data || [])).catch(() => setTasks([]));
  }, [scope]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function toggle(t: CrmTask) {
    const status = t.status === 'done' ? 'open' : 'done';
    setTasks(ts => ts?.map(x => x.id === t.id ? { ...x, status } : x) ?? null);
    try { await partnerTasks.update(t.id, { status }); onChanged(); } catch { load(); }
  }

  return (
    <div className="flex flex-col min-h-[320px]" style={card}>
      <div className="flex items-center justify-between px-[18px] pt-4 pb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Tasks</h2>
        <Segmented label="Whose tasks" value={scope} onChange={setScope}
          options={[{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Team' }, { value: 'unassigned', label: 'Unassigned' }]} />
      </div>
      <ul className="flex-1">
        {tasks?.map(t => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
        {tasks && !tasks.length && (
          <li className="px-[18px] py-10 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
            {scope === 'mine' ? 'Nothing assigned to you.' : scope === 'team' ? 'No open tasks.' : 'Every task has an owner.'}
          </li>
        )}
      </ul>
      <button type="button" onClick={onNewTask}
        className="flex items-center gap-2 px-[18px] py-3 text-[13px] text-left hover:bg-[var(--surface-sunken)] transition-colors"
        style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)', borderBottomLeftRadius: 'var(--radius-card)', borderBottomRightRadius: 'var(--radius-card)' }}>
        <Plus className="w-3.5 h-3.5" />Add a task for a person or a group…
      </button>
    </div>
  );
}

// ── Reach out next ────────────────────────────────────────────────────────────

const KIND_CHIP: Record<Suggestion['kind'], { label: string; color: string; bg: string }> = {
  followup: { label: 'Follow-up due', color: 'var(--state-danger)', bg: 'var(--state-danger-bg)' },
  task: { label: 'Overdue task', color: 'var(--state-danger)', bg: 'var(--state-danger-bg)' },
  slipping: { label: 'Slipping', color: 'var(--state-warning)', bg: 'var(--state-warning-bg)' },
  cold: { label: 'Going cold', color: 'var(--state-warning)', bg: 'var(--state-warning-bg)' },
};

function SuggestionRow({ s, onDone }: { s: Suggestion; onDone: (id: string) => void }) {
  const [logging, setLogging] = useState(false);
  const [kind, setKind] = useState('email');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chip = KIND_CHIP[s.kind];

  async function snooze() {
    setBusy(true);
    try { await partnersApi.snooze(s.partner_id, 14); onDone(s.partner_id); } finally { setBusy(false); }
  }
  async function log() {
    setBusy(true);
    try {
      await partnersApi.addUpdate(s.partner_id, {
        update_type: kind, content: note.trim() || `Logged ${kind}`, contact_date: new Date().toISOString(),
      });
      onDone(s.partner_id);
    } finally { setBusy(false); }
  }

  return (
    <li className="px-[18px] py-3 flex gap-3" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
      <Avatar name={s.name} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/partners/${s.partner_id}`} className="text-[13px] font-semibold hover:underline" style={{ color: 'var(--ink-primary)' }}>{s.name}</Link>
          <span className="text-[11px] font-medium px-1.5 py-px rounded-full" style={{ color: chip.color, background: chip.bg }}>{chip.label}</span>
        </div>
        <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--ink-muted)' }}>{s.reason}</p>
        {logging ? (
          <div className="flex gap-1.5 mt-2">
            <select aria-label="Contact type" value={kind} onChange={e => setKind(e.target.value)} className="h-7 px-1.5 text-xs" style={fieldStyle}>
              <option value="email">Email</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="other">Other</option>
            </select>
            <input autoFocus aria-label="Note" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') log(); if (e.key === 'Escape') setLogging(false); }}
              placeholder="What happened? (optional)" className="h-7 px-2 text-xs flex-1 min-w-0" style={fieldStyle} />
            <button type="button" onClick={log} disabled={busy} className="h-7 px-2.5 text-xs font-medium disabled:opacity-50" style={btnPrimary}>Save</button>
          </div>
        ) : (
          <div className="flex gap-1.5 mt-2">
            <Link href={`/partners/${s.partner_id}?tab=insights`} className="h-7 px-2.5 text-xs font-medium flex items-center" style={btnPrimary}>Draft email</Link>
            <button type="button" onClick={() => setLogging(true)} className="h-7 px-2.5 text-xs" style={btnQuiet}>Log touch</button>
            <button type="button" onClick={snooze} disabled={busy} className="h-7 px-2 text-xs disabled:opacity-50" style={{ color: 'var(--ink-muted)' }}>Snooze 2w</button>
          </div>
        )}
      </div>
    </li>
  );
}

export function ReachOutCard({ data, onChanged }: { data: HomeData | null; onChanged: () => void }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const list = (data?.suggestions || []).filter(s => !hidden.has(s.partner_id));
  return (
    <div className="flex flex-col" style={card}>
      <div className="flex items-center justify-between px-[18px] pt-4 pb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Reach out next</h2>
        {data && <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{list.length} suggestion{list.length === 1 ? '' : 's'}</span>}
      </div>
      <ul>
        {list.map(s => (
          <SuggestionRow key={s.partner_id} s={s} onDone={id => { setHidden(h => new Set(h).add(id)); onChanged(); }} />
        ))}
      </ul>
      {data && !list.length && (
        <p className="px-[18px] py-10 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
          You’re caught up. Nobody is going cold.
        </p>
      )}
    </div>
  );
}

// ── This week ─────────────────────────────────────────────────────────────────

export function ThisWeekCard({ data }: { data: HomeData | null }) {
  const weeks = data?.weekly_touches || [];
  const max = Math.max(1, ...weeks);
  const first = new Date(Date.now() - 11 * 7 * 86_400_000);
  return (
    <div className="flex flex-col gap-5">
      <div className="px-[18px] py-4" style={card}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink-primary)' }}>Next 7 days</h2>
        {data?.meetings.map(m => {
          const d = new Date(m.scheduled_at);
          return (
            <div key={m.id} className="flex gap-3 py-2" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
              <div className="w-10 text-center shrink-0">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div className="mono-data text-lg font-medium" style={{ color: 'var(--ink-primary)' }}>{d.getDate()}</div>
              </div>
              <div className="min-w-0">
                <Link href={`/partners/${m.partner_id}`} className="text-[13px] font-medium leading-snug hover:underline block truncate" style={{ color: 'var(--ink-primary)' }}>{m.title}</Link>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>
                  {m.partner_name} · {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
        {data && !data.meetings.length && <p className="text-xs py-3" style={{ color: 'var(--ink-muted)' }}>No meetings scheduled.</p>}
      </div>
      <div className="px-[18px] py-4" style={card}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Team touches</h2>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>12 weeks</span>
        </div>
        <div className="flex items-end gap-1 h-16 mt-3.5" role="img" aria-label={`Touches per week: ${weeks.join(', ')}`}>
          {weeks.map((v, i) => (
            <div key={i} title={`${v} touch${v === 1 ? '' : 'es'}`} className="flex-1 rounded-t-[3px]"
              style={{ height: `${Math.max(4, (v / max) * 100)}%`, background: i === weeks.length - 1 ? 'var(--ink-primary)' : 'var(--rule-strong)' }} />
          ))}
        </div>
        <div className="mono-data flex justify-between text-[11px] mt-1.5" style={{ color: 'var(--ink-muted)' }}>
          <span>{first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><span>This week</span>
        </div>
      </div>
    </div>
  );
}
