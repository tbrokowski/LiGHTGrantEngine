'use client';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { CrmTask, DueChip, initials } from './crmUi';

/** One task line: checkbox, title, what it's for (person or group), due chip, assignee. */
export default function TaskRow({
  task, onToggle, showTarget = true, compact = false,
}: { task: CrmTask; onToggle: (t: CrmTask) => void; showTarget?: boolean; compact?: boolean }) {
  const done = task.status === 'done';
  const isGroup = !!task.group_id;
  const href = isGroup ? `/partners/groups/${task.group_id}` : `/partners/${task.partner_id}`;
  const target = isGroup ? task.group_name : task.partner_name;
  return (
    <li className={`flex items-center gap-3 ${compact ? 'px-4 py-2' : 'px-[18px] py-2.5'}`} style={{ borderTop: '1px solid var(--rule-subtle)' }}>
      <button
        type="button"
        onClick={() => onToggle(task)}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${task.title}`}
        className="w-[18px] h-[18px] rounded-[5px] shrink-0 flex items-center justify-center transition-colors"
        style={done
          ? { background: 'var(--state-success)', border: '1.5px solid var(--state-success)' }
          : { background: 'var(--surface-base)', border: '1.5px solid var(--rule-strong)' }}
      >
        {done && <Check className="w-3 h-3" strokeWidth={3.5} style={{ color: 'var(--ink-inverse)' }} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate" style={{ color: done ? 'var(--ink-faint)' : 'var(--ink-primary)', textDecoration: done ? 'line-through' : undefined }}>
          {task.title}
        </div>
        {showTarget && target && (
          <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {isGroup
              ? <span style={{ width: 8, height: 8, borderRadius: 2, background: task.group_color || 'var(--ink-muted)' }} />
              : <span style={{ width: 8, height: 8, borderRadius: 999, border: '1.5px solid var(--ink-muted)' }} />}
            <span>{isGroup ? 'Group' : 'Person'}</span>
            <Link href={href} className="font-medium hover:underline truncate" style={{ color: 'var(--ink-secondary)' }}>{target}</Link>
          </div>
        )}
      </div>
      <DueChip due={task.due_date} done={done} />
      <span
        title={task.assignee_name ? `Assigned to ${task.assignee_name}` : 'Unassigned'}
        className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold"
        style={task.assignee_name
          ? { background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }
          : { border: '1px dashed var(--rule-strong)', color: 'var(--ink-faint)' }}
      >
        {task.assignee_name ? initials(task.assignee_name) : '?'}
      </span>
    </li>
  );
}
