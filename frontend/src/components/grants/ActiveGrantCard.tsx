'use client';
import { useState } from 'react';
import Link from 'next/link';
import StageTransitionModal from './StageTransitionModal';
import { GrantSummary } from './ProposalCard';
import { grants as grantsApi } from '@/lib/api';

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function formatCurrency(amount: number | null, currency: string | null) {
  if (!amount) return null;
  const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return `${currency ?? '$'}${fmt.format(amount)}`;
}

function TaskProgress({ tasks }: { tasks?: { status: string }[] }) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t => t.status === 'completed').length;
  const pct = Math.round((done / tasks.length) * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-0.5 w-20 overflow-hidden"
        style={{ background: 'var(--rule-subtle)', borderRadius: 'var(--radius-xs)' }}
      >
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            background: 'var(--accent-primary)',
            borderRadius: 'var(--radius-xs)',
          }}
        />
      </div>
      <span className="mono-data text-[10px]" style={{ color: 'var(--ink-faint)' }}>
        {done}/{tasks.length}
      </span>
    </div>
  );
}

interface Props {
  grant: GrantSummary;
  onStageChange: (id: string, newStage: string) => void;
  onDelete: (id: string) => void;
  onDeadlineChange?: (id: string, deadline: string | null) => void;
}

export default function ActiveGrantCard({ grant, onStageChange, onDelete, onDeadlineChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);

  async function handleSaveDeadline() {
    setSavingDeadline(true);
    try {
      const newDeadline = deadlineInput || null;
      await grantsApi.update(grant.id, { external_deadline: newDeadline });
      onDeadlineChange?.(grant.id, newDeadline);
      setEditingDeadline(false);
    } catch {
      alert('Failed to save deadline.');
    } finally {
      setSavingDeadline(false);
    }
  }

  const awardedDate = formatDate(grant.decision_at);
  const awardAmt = formatCurrency(grant.award_amount, grant.currency);
  const meta: string[] = [];
  if (grant.funder) meta.push(grant.funder);
  if (grant.pi_name) meta.push(grant.pi_name);

  const accentColor = grant.color ?? 'var(--accent-cool)';

  return (
    <>
      {archiving && (
        <StageTransitionModal
          grantId={grant.id}
          grantTitle={grant.title}
          transitionType="archive"
          onClose={() => setArchiving(false)}
          onSuccess={(stage) => { setArchiving(false); onStageChange(grant.id, stage); }}
        />
      )}

      {/* Edit deadline mini-modal */}
      {editingDeadline && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          style={{ background: 'var(--surface-overlay)' }}
        >
          <div
            className="p-6 w-80"
            style={{
              background: 'var(--surface-panel)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--rule-subtle)',
              boxShadow: 'var(--shadow-floating)',
            }}
          >
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--ink-primary)' }}>
              Edit Project End Date
            </h3>
            <p className="text-xs mb-4 truncate" style={{ color: 'var(--ink-muted)' }}>{grant.title}</p>
            <input
              type="date"
              value={deadlineInput}
              onChange={e => setDeadlineInput(e.target.value)}
              className="w-full px-3 py-2 text-sm mb-4"
              style={{
                border: '1px solid var(--rule-subtle)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-sunken)',
                color: 'var(--ink-primary)',
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditingDeadline(false)}
                className="px-3 py-1.5 text-sm transition-colors"
                style={{ color: 'var(--ink-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDeadline}
                disabled={savingDeadline}
                className="px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {savingDeadline ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="group flex items-stretch rounded-xl overflow-hidden transition-all duration-150"
        style={{
          background: 'var(--surface-base)',
          border: '1px solid var(--rule-subtle)',
          borderLeft: `4px solid ${accentColor}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.10)')}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)')}
      >
        {/* Main content */}
        <Link href={`/grants/${grant.id}/workspace`} className="flex-1 min-w-0 px-5 py-4">
          {/* Top row */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
              style={{ background: 'var(--state-success-bg)', color: 'var(--state-success)' }}
            >
              Active
            </span>
            {awardAmt && (
              <span className="text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>
                {awardAmt}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold leading-snug" style={{ color: 'var(--ink-primary)' }}>
            {grant.title}
          </h3>

          {/* Meta */}
          {meta.length > 0 && (
            <p className="text-xs mt-1.5 truncate" style={{ color: 'var(--ink-muted)' }}>
              {meta.join('  ·  ')}
            </p>
          )}

          {/* Progress + dates */}
          <div className="mt-2.5 flex items-center gap-4 flex-wrap">
            <TaskProgress tasks={grant.tasks} />
            {awardedDate && (
              <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                Awarded {awardedDate}
              </span>
            )}
            {grant.external_deadline ? (
              <span
                className="text-xs px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
              >
                Ends {formatDate(grant.external_deadline)}
              </span>
            ) : (
              <span className="text-xs italic" style={{ color: 'var(--ink-faint)' }}>
                No end date
              </span>
            )}
          </div>
        </Link>

        {/* Right: actions */}
        <div className="flex flex-col items-end justify-start px-4 py-4 shrink-0">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(v => !v)}
              className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-xs)] transition-colors"
              style={{ color: 'var(--ink-faint)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'var(--surface-sunken)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink-faint)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-44 py-1 z-10"
                style={{
                  border: '1px solid var(--rule-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-panel)',
                  boxShadow: 'var(--shadow-floating)',
                }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeadlineInput(grant.external_deadline?.substring(0, 10) ?? '');
                    setEditingDeadline(true);
                  }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--ink-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Edit End Date
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setArchiving(true); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--ink-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Move to Archive
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onDelete(grant.id); }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors"
                  style={{ color: 'var(--ink-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
