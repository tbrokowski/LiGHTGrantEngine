'use client';

import { useState } from 'react';
import { AlertTriangle, CalendarDays, CheckSquare, DollarSign, Folder, Pencil, Users, TrendingUp } from 'lucide-react';
import type { WorkspaceSummary, Task, Milestone } from './types';

interface GrantInfo {
  id: string;
  title: string;
  funder?: string | null;
  pi_name?: string | null;
  award_amount?: number | null;
  currency?: string | null;
  external_deadline?: string | null;
  decision_at?: string | null;
  color?: string | null;
}

interface Props {
  grant: GrantInfo;
  summary: WorkspaceSummary;
  tasks: Task[];
  onTabChange: (tab: string) => void;
  onDeadlineChange?: (newDeadline: string | null) => void;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (!amount) return null;
  const sym = currency && currency.length <= 3 && currency !== 'USD' ? currency : '$';
  return `${sym}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)}`;
}

function ProjectPeriodBar({
  awardedDate,
  endDate,
  onEditEndDate,
}: {
  awardedDate: string | null;
  endDate: string | null;
  onEditEndDate?: () => void;
}) {
  if (!awardedDate || !endDate) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-emerald-600/70">
          {awardedDate ? `Awarded ${formatDate(awardedDate)}` : 'Active grant'}
        </p>
        {onEditEndDate && (
          <button
            type="button"
            onClick={onEditEndDate}
            className="text-emerald-500 hover:text-emerald-700 transition-colors"
            title="Set project end date"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  const start = new Date(awardedDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, now - start);
  const pct = Math.min(100, Math.round((elapsed / total) * 100));
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const totalDays = Math.round(total / 86400000);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-emerald-700/70">
          {formatDate(awardedDate)}
        </span>
        <span className={`font-medium ${daysLeft <= 30 ? 'text-amber-600' : 'text-emerald-700'}`}>
          {daysLeft > 0 ? `${daysLeft}d remaining` : 'Period ended'}
        </span>
        <span className="flex items-center gap-1.5 text-emerald-700/70">
          {formatDate(endDate)}
          {onEditEndDate && (
            <button
              type="button"
              onClick={onEditEndDate}
              className="text-emerald-400 hover:text-emerald-700 transition-colors"
              title="Edit project end date"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full bg-emerald-200/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${daysLeft <= 30 ? 'bg-amber-400' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-emerald-600/70 text-right">
        {pct}% of {totalDays}d elapsed
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'red' | 'amber' | 'emerald' | 'blue';
  onClick?: () => void;
}) {
  const accentStyles = {
    red: 'border-red-200 bg-red-50',
    amber: 'border-amber-200 bg-amber-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    blue: 'border-blue-200 bg-blue-50',
  };
  const valueStyles = {
    red: 'text-red-700',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
    blue: 'text-blue-700',
  };

  const containerCls = `flex-1 min-w-0 rounded-xl border px-4 py-3 transition-all ${
    onClick ? 'cursor-pointer hover:shadow-sm hover:-translate-y-px' : ''
  } ${accent ? accentStyles[accent] : 'border-gray-100 bg-white'}`;

  const content = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-none ${accent ? valueStyles[accent] : 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </>
  );

  return onClick ? (
    <button onClick={onClick} className={containerCls}>{content}</button>
  ) : (
    <div className={containerCls}>{content}</div>
  );
}

function AlertBanner({ icon: Icon, message, color, onClick }: {
  icon: React.ElementType;
  message: string;
  color: 'red' | 'amber' | 'blue';
  onClick: () => void;
}) {
  const styles = {
    red: 'bg-red-50 border-red-100 text-red-700 hover:bg-red-100/60',
    amber: 'bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100/60',
    blue: 'bg-blue-50 border-blue-100 text-blue-700 hover:bg-blue-100/60',
  };
  const iconStyles = { red: 'text-red-500', amber: 'text-amber-500', blue: 'text-blue-400' };
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left transition-colors group ${styles[color]}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${iconStyles[color]}`} />
      <span className="text-sm font-medium">{message}</span>
      <span className="ml-auto text-xs opacity-50 group-hover:opacity-80">View →</span>
    </button>
  );
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
  const days = milestone.target_date ? Math.ceil((new Date(milestone.target_date).getTime() - Date.now()) / 86400000) : null;
  const overdue = days !== null && days < 0 && milestone.status !== 'complete';
  const urgent = days !== null && days <= 7 && !overdue;

  const statusDot: Record<string, string> = {
    upcoming: 'bg-blue-400',
    at_risk: 'bg-amber-400',
    complete: 'bg-emerald-500',
    missed: 'bg-red-500',
    cancelled: 'bg-gray-300',
  };

  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot[milestone.status] ?? 'bg-gray-300'}`} />
      <span className={`flex-1 text-sm min-w-0 truncate ${milestone.status === 'complete' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
        {milestone.title}
      </span>
      {milestone.target_date && (
        <span className={`text-xs shrink-0 ${overdue ? 'text-red-500' : urgent ? 'text-amber-600' : 'text-gray-400'}`}>
          {new Date(milestone.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {overdue && ` (${Math.abs(days!)}d late)`}
          {!overdue && days !== null && days <= 14 && ` (${days}d)`}
        </span>
      )}
    </div>
  );
}

function QuickLink({ icon: Icon, label, tab, onClick }: {
  icon: React.ElementType;
  label: string;
  tab: string;
  onClick: (tab: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(tab)}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm transition-all"
    >
      <Icon className="w-3.5 h-3.5 opacity-60" />
      {label}
    </button>
  );
}

export default function ActiveGrantDashboard({ grant, summary, tasks, onTabChange, onDeadlineChange }: Props) {
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);

  async function handleSaveDeadline() {
    setSavingDeadline(true);
    try {
      const newDeadline = deadlineInput || null;
      onDeadlineChange?.(newDeadline);
      setEditingDeadline(false);
    } finally {
      setSavingDeadline(false);
    }
  }

  const awardDisplay = formatCurrency(grant.award_amount, grant.currency);
  const taskPct = summary.total_tasks > 0
    ? Math.round((summary.complete_tasks / summary.total_tasks) * 100)
    : 0;
  const upcomingMilestones = summary.upcoming_milestones.filter(m => m.status !== 'complete').slice(0, 5);

  const overdueTasks = tasks.filter(t =>
    t.due_date && t.status !== 'complete' && t.status !== 'dropped' && new Date(t.due_date) < new Date()
  ).length;

  return (
    <div className="p-5 space-y-6 max-w-4xl">
      {editingDeadline && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-80">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Edit Project End Date</h3>
            <p className="text-xs text-gray-400 mb-4">{grant.title}</p>
            <input
              type="date"
              value={deadlineInput}
              onChange={e => setDeadlineInput(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditingDeadline(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDeadline}
                disabled={savingDeadline}
                className="px-4 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {savingDeadline ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Award card ── */}
      <div
        className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5"
        style={grant.color ? { borderLeftColor: grant.color, borderLeftWidth: '4px' } : undefined}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                Active Grant
              </span>
              {awardDisplay && (
                <span className="text-sm font-bold text-emerald-800">{awardDisplay}</span>
              )}
              {grant.currency === 'USD' && grant.award_amount && (
                <span className="text-xs text-emerald-600">
                  USD {grant.award_amount.toLocaleString()}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-gray-900 leading-snug">{grant.title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              {grant.funder && <span className="text-xs text-gray-500">{grant.funder}</span>}
              {grant.pi_name && (
                <>
                  <span className="text-gray-300 text-xs">·</span>
                  <span className="text-xs text-gray-500">PI: {grant.pi_name}</span>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0">
            <TrendingUp className="w-8 h-8 text-emerald-200" />
          </div>
        </div>

        <ProjectPeriodBar
          awardedDate={grant.decision_at ?? null}
          endDate={grant.external_deadline ?? null}
          onEditEndDate={onDeadlineChange ? () => {
            setDeadlineInput(grant.external_deadline?.substring(0, 10) ?? '');
            setEditingDeadline(true);
          } : undefined}
        />
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Tasks"
          value={`${summary.complete_tasks}/${summary.total_tasks}`}
          sub={`${taskPct}% complete`}
          accent={taskPct === 100 ? 'emerald' : undefined}
          onClick={() => onTabChange('tasks')}
        />
        <StatCard
          label="Overdue"
          value={overdueTasks}
          sub={overdueTasks > 0 ? 'need attention' : 'all on time'}
          accent={overdueTasks > 0 ? 'red' : 'emerald'}
          onClick={() => onTabChange('tasks')}
        />
        <StatCard
          label="Milestones"
          value={upcomingMilestones.length}
          sub="upcoming"
          accent={upcomingMilestones.some(m => m.status === 'at_risk') ? 'amber' : undefined}
          onClick={() => onTabChange('milestones')}
        />
        <StatCard
          label="Budget"
          value={summary.budget_status === 'on_track' ? 'On Track' : summary.budget_status === 'over_budget' ? 'Over' : summary.budget_status === 'under_budget' ? 'Under' : '—'}
          accent={summary.budget_status === 'over_budget' ? 'red' : summary.budget_status === 'on_track' ? 'emerald' : undefined}
          onClick={() => onTabChange('budget')}
        />
      </div>

      {/* ── Alert banners ── */}
      {(summary.overdue_tasks > 0 || summary.blocked_tasks > 0 || summary.due_this_week_tasks > 0 || summary.pending_partners > 0) && (
        <div className="space-y-2">
          {summary.overdue_tasks > 0 && (
            <AlertBanner
              icon={AlertTriangle}
              message={`${summary.overdue_tasks} task${summary.overdue_tasks !== 1 ? 's' : ''} overdue`}
              color="red"
              onClick={() => onTabChange('tasks')}
            />
          )}
          {summary.blocked_tasks > 0 && (
            <AlertBanner
              icon={AlertTriangle}
              message={`${summary.blocked_tasks} task${summary.blocked_tasks !== 1 ? 's' : ''} blocked`}
              color="amber"
              onClick={() => onTabChange('tasks')}
            />
          )}
          {summary.due_this_week_tasks > 0 && summary.overdue_tasks === 0 && (
            <AlertBanner
              icon={CalendarDays}
              message={`${summary.due_this_week_tasks} task${summary.due_this_week_tasks !== 1 ? 's' : ''} due this week`}
              color="amber"
              onClick={() => onTabChange('tasks')}
            />
          )}
          {summary.pending_partners > 0 && (
            <AlertBanner
              icon={Users}
              message={`${summary.pending_partners} partner${summary.pending_partners !== 1 ? 's' : ''} pending confirmation`}
              color="blue"
              onClick={() => onTabChange('team')}
            />
          )}
        </div>
      )}

      {/* ── Two-column content ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Upcoming milestones */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Upcoming Milestones</h3>
            <button
              onClick={() => onTabChange('milestones')}
              className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              View all →
            </button>
          </div>
          {upcomingMilestones.length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center">No upcoming milestones.</p>
          ) : (
            <div>
              {upcomingMilestones.map(m => (
                <MilestoneItem key={m.id} milestone={m} />
              ))}
            </div>
          )}
        </div>

        {/* Next reporting + quick actions */}
        <div className="space-y-3">
          {/* Next reporting deadline */}
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Reporting</h3>
            {summary.days_to_external_deadline !== null ? (
              <div className="flex items-start gap-3">
                <CalendarDays className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Project Deadline</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {summary.external_deadline ? formatDate(summary.external_deadline) : ''}
                    {summary.days_to_external_deadline !== null && (
                      <span className={`ml-1 ${summary.days_to_external_deadline <= 30 ? 'text-amber-600 font-medium' : ''}`}>
                        ({summary.days_to_external_deadline}d remaining)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-2">
                No deadline set.{' '}
                <button onClick={() => onTabChange('milestones')} className="text-indigo-500 hover:underline">
                  Manage in Milestones →
                </button>
              </p>
            )}
          </div>

          {/* Quick links */}
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Quick Access</h3>
            <div className="flex flex-wrap gap-2">
              <QuickLink icon={CheckSquare} label="Tasks" tab="tasks" onClick={onTabChange} />
              <QuickLink icon={CalendarDays} label="Milestones" tab="milestones" onClick={onTabChange} />
              <QuickLink icon={DollarSign} label="Budget" tab="budget" onClick={onTabChange} />
              <QuickLink icon={Folder} label="Files" tab="files" onClick={onTabChange} />
              <QuickLink icon={Users} label="Team" tab="team" onClick={onTabChange} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
