'use client';
// Tasks card at the top of the Partners home: my / team / unassigned tasks
// across every person and group.
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { partnerTasks } from '@/lib/api';
import { CrmTask, Segmented, card, btnPrimary } from '../crmUi';
import TaskRow from '../TaskRow';

const PAGE = 8;

export function MyTasksCard({ refreshKey, onNewTask, onChanged }: { refreshKey: number; onNewTask: () => void; onChanged: () => void }) {
  const [scope, setScope] = useState<'mine' | 'team' | 'unassigned'>('mine');
  const [tasks, setTasks] = useState<CrmTask[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    partnerTasks.list({ scope, include_done: true, limit: 100 }).then(r => setTasks(r.data || [])).catch(() => setTasks([]));
  }, [scope]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setShowAll(false); }, [scope]);

  async function toggle(t: CrmTask) {
    const status = t.status === 'done' ? 'open' : 'done';
    setTasks(ts => ts?.map(x => x.id === t.id ? { ...x, status } : x) ?? null);
    try { await partnerTasks.update(t.id, { status }); onChanged(); } catch { load(); }
  }

  const shown = showAll ? tasks : tasks?.slice(0, PAGE);
  const hidden = (tasks?.length ?? 0) - (shown?.length ?? 0);

  return (
    <div className="flex flex-col" style={card}>
      <div className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Tasks</h2>
        <div className="flex items-center gap-2">
          <Segmented label="Whose tasks" value={scope} onChange={setScope}
            options={[{ value: 'mine', label: 'Mine' }, { value: 'team', label: 'Team' }, { value: 'unassigned', label: 'Unassigned' }]} />
          <button type="button" onClick={onNewTask} className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium" style={btnPrimary}>
            <Plus className="w-3.5 h-3.5" />New task
          </button>
        </div>
      </div>
      <ul>
        {shown?.map(t => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
        {tasks && !tasks.length && (
          <li className="px-[18px] py-8 text-center text-sm" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
            {scope === 'mine' ? 'Nothing assigned to you.' : scope === 'team' ? 'No open tasks.' : 'Every task has an owner.'}
          </li>
        )}
      </ul>
      {(hidden > 0 || showAll) && (tasks?.length ?? 0) > PAGE && (
        <button type="button" onClick={() => setShowAll(v => !v)}
          className="px-[18px] py-2.5 text-left text-[13px] hover:bg-[var(--surface-sunken)]"
          style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}>
          {showAll ? 'Show fewer' : `Show all ${tasks!.length}`}
        </button>
      )}
    </div>
  );
}
