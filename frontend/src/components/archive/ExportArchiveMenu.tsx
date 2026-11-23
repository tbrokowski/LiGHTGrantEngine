'use client';
/**
 * Download archived grants as CSV: figures, tags, notes, lessons learned,
 * internal debrief, reviewer feedback and comments. Scope is the grants in
 * view (shown in the list / selected in Insights) or the whole archive.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { archiveInsights } from '@/lib/api';
import { GhostButton, Menu } from './insights/ui';

async function errorMessage(err: unknown): Promise<string> {
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { detail?: unknown };
      if (typeof parsed.detail === 'string') return parsed.detail;
    } catch { /* not JSON */ }
  }
  return 'Could not export. Please try again.';
}

export default function ExportArchiveMenu({
  scopeLabel, scopeIds, scopeIsAll, totalCount, align = 'right',
}: {
  /** e.g. "Shown" or "Selected". */
  scopeLabel: string;
  scopeIds: string[];
  /** The grants in view are the whole archive (no filter or selection narrowing it). */
  scopeIsAll: boolean;
  /** Size of the whole archive, when known. */
  totalCount: number | null;
  align?: 'left' | 'right';
}) {
  const [scope, setScope] = useState<'scope' | 'all'>('scope');
  const [comments, setComments] = useState(true);
  const [busy, setBusy] = useState(false);
  const sameAsAll = scopeIsAll;

  async function download(close: () => void) {
    const ids = scope === 'all' || sameAsAll ? null : scopeIds;
    if (ids && !ids.length) return toast.error(`No grants ${scopeLabel.toLowerCase()} to export.`);
    setBusy(true);
    try {
      const res = await archiveInsights.exportCsv(ids, comments);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archive-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      close();
    } catch (err) {
      toast.error(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const radio = (value: 'scope' | 'all', label: string, count: number | null, disabled = false) => (
    <label className={`flex items-center justify-between gap-2 px-3 py-1.5 text-xs ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      style={{ color: 'var(--ink-secondary)' }}>
      <span className="flex items-center gap-2">
        <input type="radio" name="archive-export-scope" checked={(sameAsAll ? 'all' : scope) === value} disabled={disabled}
          onChange={() => setScope(value)} className="accent-[#18181B]" />
        {label}
      </span>
      {count != null && <span className="mono-data" style={{ color: 'var(--ink-muted)' }}>{count}</span>}
    </label>
  );

  return (
    <Menu align={align} width={264} button={(open, toggle) => (
      <GhostButton onClick={toggle} active={open} title="Download grants with notes and comments as CSV">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
        </svg>
        Export
      </GhostButton>
    )}>
      {close => (
        <div className="py-1.5">
          <div className="ledger-label px-3 pb-1">Export CSV</div>
          {!sameAsAll && radio('scope', `${scopeLabel} grants`, scopeIds.length, !scopeIds.length)}
          {radio('all', 'Whole archive', totalCount)}
          <label className="flex items-start gap-2 px-3 py-1.5 mt-1 text-xs cursor-pointer" style={{ color: 'var(--ink-secondary)', borderTop: '1px solid var(--rule-subtle)' }}>
            <input type="checkbox" checked={comments} onChange={e => setComments(e.target.checked)} className="mt-0.5 accent-[#18181B]" />
            <span>
              Include comments
              <span className="block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>On the archive entry and on the proposal it came from</span>
            </span>
          </label>
          <p className="px-3 pt-1 text-[10.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            Includes figures, odds, tags, notes, lessons learned, internal debrief and reviewer feedback.
          </p>
          <div className="px-3 pt-2">
            <button type="button" disabled={busy} onClick={() => download(close)}
              className="w-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}>
              {busy ? 'Preparing…' : 'Download CSV'}
            </button>
          </div>
        </div>
      )}
    </Menu>
  );
}
