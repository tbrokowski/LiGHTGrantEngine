'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { partnerGroups } from '@/lib/api';
import { initials, card, btnOutline, dueInfo } from '../crmUi';

interface GroupSummary {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  member_count: number;
  members_preview: { id: string; name: string }[];
  engaged_30d: number;
  engagement_pct: number;
  open_tasks: number;
  overdue_tasks: number;
  next_due: { title: string; due_date: string } | null;
}

export default function GroupsPanel({ refreshKey, onNewGroup }: { refreshKey: number; onNewGroup: () => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);

  useEffect(() => { partnerGroups.list().then(r => setGroups(r.data || [])).catch(() => setGroups([])); }, [refreshKey]);

  return (
    <div className="flex flex-col min-h-0" style={card}>
      <div className="px-[18px] pt-4 pb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
          Groups <span className="mono-data font-normal" style={{ color: 'var(--ink-muted)' }}>{groups ? groups.length : ''}</span>
        </h2>
        <button type="button" onClick={onNewGroup} className="h-[30px] px-2.5 text-xs font-medium" style={btnOutline}>+ New group</button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-3.5 pb-3.5 flex flex-col gap-2.5">
        {groups === null && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-[var(--radius-lg)]" style={{ background: 'var(--surface-sunken)' }} />
        ))}
        {groups?.map(g => {
          const color = g.color || 'var(--ink-muted)';
          const chip = g.overdue_tasks
            ? { text: `${g.open_tasks} open · ${g.overdue_tasks} overdue`, color: 'var(--state-danger)', bg: 'var(--state-danger-bg)' }
            : g.open_tasks
              ? { text: `${g.open_tasks} open`, color: 'var(--ink-secondary)', bg: 'var(--surface-sunken)' }
              : { text: 'No tasks', color: 'var(--ink-muted)', bg: 'transparent' };
          const due = g.next_due ? dueInfo(g.next_due.due_date) : null;
          const meta = g.next_due && due
            ? `${due.tone === 'over' ? due.label : due.tone === 'today' ? 'Due today' : `Next due ${due.label}`}: ${g.next_due.title}`
            : g.description || `${g.engaged_30d} of ${g.member_count} contacted in the last 30 days`;
          return (
            <Link key={g.id} href={`/partners/groups/${g.id}`}
              className="flex flex-col gap-2.5 p-3.5 rounded-[var(--radius-lg)] transition-colors hover:bg-[var(--surface-sunken)]"
              style={{ border: '1px solid var(--rule-subtle)' }}>
              <div className="flex items-center gap-2.5">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
                <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--ink-primary)' }}>{g.name}</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style={{ color: chip.color, background: chip.bg }}>{chip.text}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex">
                  {g.members_preview.map((m, i) => (
                    <span key={m.id} title={m.name}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold"
                      style={{ marginLeft: i ? -7 : 0, border: '2px solid var(--surface-base)', background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
                      {initials(m.name)}
                    </span>
                  ))}
                </div>
                <span className="mono-data text-xs" style={{ color: 'var(--ink-muted)' }}>{g.member_count} {g.member_count === 1 ? 'person' : 'people'}</span>
                <div className="ml-auto flex items-center gap-2 w-[150px]" title={`${g.engaged_30d} of ${g.member_count} contacted in the last 30 days`}>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
                    <div className="h-full rounded-full" style={{ width: `${g.engagement_pct}%`, background: color }} />
                  </div>
                  <span className="mono-data text-xs w-9 text-right" style={{ color: 'var(--ink-secondary)' }}>{g.engagement_pct}%</span>
                </div>
              </div>
              <div className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{meta}</div>
            </Link>
          );
        })}
        {groups && !groups.length && (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No groups yet.</p>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>Group people by site, consortium or project, then give the group its own tasks.</p>
          </div>
        )}
      </div>
    </div>
  );
}
