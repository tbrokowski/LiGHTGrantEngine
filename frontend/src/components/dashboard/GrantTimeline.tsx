'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { GrantItem } from './FocusPanel';

const STAGE_DOT: Record<string, string> = {
  proposal: 'bg-blue-400',
  pending: 'bg-amber-400',
  active: 'bg-emerald-500',
  rejected: 'bg-red-400',
  archived: 'bg-gray-300',
};

const STAGE_LABEL: Record<string, string> = {
  proposal: 'Proposal',
  pending: 'Pending',
  active: 'Active',
  rejected: 'Rejected',
  archived: 'Archived',
};

function daysFrom(base: Date, target: string | null): number | null {
  if (!target) return null;
  try {
    const diff = new Date(target).getTime() - base.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

function formatAxisDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Window = 30 | 60 | 90;

const AXIS_TICKS: Record<Window, number> = { 30: 6, 60: 6, 90: 6 };
const ROW_H = 36;
const LABEL_W = 160;

interface GrantBarProps {
  grant: GrantItem;
  windowDays: Window;
  containerW: number;
  today: Date;
  starred: boolean;
}

function GrantBar({ grant, windowDays, containerW, today, starred }: GrantBarProps) {
  const gridW = containerW - LABEL_W;
  const dayPx = gridW / windowDays;

  const extDays = daysFrom(today, grant.external_deadline);
  const intDays = daysFrom(today, grant.internal_deadline);

  // Bar: from day 0 (today) to external_deadline, clamped to window
  const barStart = 0;
  const barEnd = extDays !== null ? Math.min(extDays, windowDays) : windowDays;
  const barStartPx = Math.max(0, barStart * dayPx);
  const barWidthPx = Math.max(4, (barEnd - barStart) * dayPx);

  const daysLeft = extDays;
  const isOverdue = daysLeft !== null && daysLeft < 0;
  const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
  const isSoon = daysLeft !== null && daysLeft > 7 && daysLeft <= 30;

  const barColor = grant.color
    ? ''
    : starred
    ? 'bg-indigo-200'
    : isOverdue ? 'bg-red-200'
    : isUrgent ? 'bg-amber-200'
    : isSoon ? 'bg-amber-100'
    : 'bg-emerald-100';

  const barBorder = grant.color
    ? ''
    : starred
    ? 'border-indigo-300'
    : isOverdue ? 'border-red-300'
    : isUrgent ? 'border-amber-300'
    : isSoon ? 'border-amber-200'
    : 'border-emerald-200';

  const barStyle = grant.color
    ? { backgroundColor: grant.color + '33', borderColor: grant.color + '99' }
    : undefined;

  const deadlineMarkerColor = grant.color
    ? ''
    : isOverdue ? 'bg-red-400' : isUrgent ? 'bg-amber-400' : isSoon ? 'bg-amber-300' : 'bg-emerald-400';
  const deadlineMarkerStyle = grant.color
    ? { backgroundColor: grant.color }
    : undefined;

  // Internal deadline marker position within bar
  const intMarkerPx = intDays !== null && intDays >= 0 && intDays <= windowDays
    ? intDays * dayPx
    : null;

  const dayLabel = daysLeft === null ? null
    : daysLeft < 0 ? `${Math.abs(daysLeft)}d over`
    : daysLeft === 0 ? 'Today!'
    : `${daysLeft}d`;

  const dayLabelColor = isOverdue ? 'text-red-500' : isUrgent ? 'text-amber-600' : isSoon ? 'text-amber-500' : 'text-gray-400';

  return (
    <div className="flex items-center" style={{ height: ROW_H }}>
      {/* Label */}
      <div className="shrink-0 flex items-center gap-1.5 pr-3" style={{ width: LABEL_W }}>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${grant.color ? '' : (STAGE_DOT[grant.grant_stage] ?? 'bg-gray-300')}`}
          style={grant.color ? { backgroundColor: grant.color } : undefined}
        />
        <Link href={`/grants/${grant.id}`} className="min-w-0">
          <p className="text-xs font-medium text-gray-700 truncate hover:text-gray-900 transition-colors leading-tight">
            {grant.title}
          </p>
          <p className="text-[10px] text-gray-300 leading-tight">
            {STAGE_LABEL[grant.grant_stage] ?? grant.grant_stage}
          </p>
        </Link>
      </div>

      {/* Bar area */}
      <div className="flex-1 relative" style={{ height: ROW_H }}>
        {/* Bar */}
        {extDays !== null && extDays > -windowDays && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-full border ${barColor} ${barBorder}`}
            style={{ left: barStartPx, width: barWidthPx, ...barStyle }}
          >
            {/* Internal deadline tick */}
            {intMarkerPx !== null && intMarkerPx > 4 && intMarkerPx < barWidthPx - 4 && (
              <div
                className="absolute top-0 bottom-0 w-px bg-white/70"
                style={{ left: intMarkerPx - barStartPx }}
                title={`Internal deadline: ${grant.internal_deadline}`}
              />
            )}
            {/* Deadline cap */}
            <div
              className={`absolute right-0 top-0 bottom-0 w-1.5 rounded-r-full ${deadlineMarkerColor}`}
              style={deadlineMarkerStyle}
            />
          </div>
        )}
        {/* No deadline label */}
        {extDays === null && (
          <div className="absolute inset-y-0 left-0 flex items-center">
            <span className="text-[10px] text-gray-300 italic">No deadline set</span>
          </div>
        )}
        {/* Day countdown badge */}
        {extDays !== null && extDays >= 0 && extDays <= windowDays && (
          <span
            className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold tabular-nums pl-1 ${dayLabelColor}`}
            style={{ left: Math.min(barStartPx + barWidthPx + 4, gridW - 48) }}
          >
            {dayLabel}
          </span>
        )}
        {extDays !== null && extDays < 0 && (
          <span className={`absolute top-1/2 -translate-y-1/2 left-1 text-[10px] font-semibold tabular-nums ${dayLabelColor}`}>
            {dayLabel}
          </span>
        )}
      </div>
    </div>
  );
}

interface GrantTimelineProps {
  grants: GrantItem[];
  loading: boolean;
  starredIds?: Set<string>;
}

const PROPOSAL_STAGES = new Set(['proposal', 'pending']);
const ACTIVE_STAGES = new Set(['active']);

function sortByDeadline(list: GrantItem[], today: Date): GrantItem[] {
  return [...list].sort((a, b) => {
    const da = daysFrom(today, a.external_deadline);
    const db = daysFrom(today, b.external_deadline);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

interface SectionHeaderRowProps {
  label: string;
  count: number;
  labelW: number;
}

function SectionHeaderRow({ label, count, labelW }: SectionHeaderRowProps) {
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: 0 }}>
      <div style={{ width: labelW }} className="shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</span>
        <span className="ml-1.5 text-[10px] text-gray-300">({count})</span>
      </div>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

export default function GrantTimeline({ grants, loading, starredIds = new Set() }: GrantTimelineProps) {
  const [window, setWindow] = useState<Window>(60);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(700);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const gridW = containerW - LABEL_W;

  const proposals = sortByDeadline(
    grants.filter(g => PROPOSAL_STAGES.has(g.grant_stage)),
    today,
  );
  const activeGrants = sortByDeadline(
    grants.filter(g => ACTIVE_STAGES.has(g.grant_stage)),
    today,
  );
  const otherGrants = sortByDeadline(
    grants.filter(g => !PROPOSAL_STAGES.has(g.grant_stage) && !ACTIVE_STAGES.has(g.grant_stage)),
    today,
  );

  const hasAny = grants.length > 0;

  // Build axis ticks
  const ticks = AXIS_TICKS[window];
  const tickDates: Date[] = [];
  for (let i = 0; i <= ticks; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + Math.round((window / ticks) * i));
    tickDates.push(d);
  }

  function renderRows(list: GrantItem[], isFirstSection: boolean) {
    return list.map((g, idx) => (
      <div key={g.id} className={`relative ${idx > 0 || !isFirstSection ? 'border-t border-gray-50' : ''}`}>
        <GrantBar
          grant={g}
          windowDays={window}
          containerW={containerW}
          today={today}
          starred={starredIds.has(g.id)}
        />
      </div>
    ));
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Grant Timeline</h2>
        <div className="flex items-center gap-1">
          {([30, 60, 90] as Window[]).map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                window === w
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-9 bg-gray-50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !hasAny ? (
          <div className="py-10 text-center">
            <p className="text-sm text-gray-400">No grants in your pipeline</p>
            <p className="text-xs text-gray-300 mt-1">Add a grant from an opportunity to see it here</p>
          </div>
        ) : (
          <div ref={containerRef} className="w-full">
            {/* Axis */}
            <div className="flex mb-1" style={{ height: 20 }}>
              <div style={{ width: LABEL_W }} />
              <div className="flex-1 relative">
                {tickDates.map((d, i) => (
                  <span
                    key={i}
                    className="absolute text-[10px] text-gray-300 -translate-x-1/2 whitespace-nowrap"
                    style={{ left: (i / ticks) * gridW }}
                  >
                    {formatAxisDate(d)}
                  </span>
                ))}
              </div>
            </div>

            {/* Today line + rows */}
            <div className="relative">
              {/* Grid lines */}
              <div className="absolute top-0 bottom-0 flex" style={{ left: LABEL_W, right: 0 }}>
                {tickDates.map((_, i) => (
                  <div key={i} className="absolute top-0 bottom-0 w-px bg-gray-50" style={{ left: (i / ticks) * gridW }} />
                ))}
              </div>

              {/* Today marker */}
              <div
                className="absolute top-0 bottom-0 w-px bg-gray-300 z-10"
                style={{ left: LABEL_W }}
                title="Today"
              />
              <div
                className="absolute -top-1 text-[9px] font-bold text-gray-400 z-10 -translate-x-1/2"
                style={{ left: LABEL_W }}
              >
                today
              </div>

              {/* ── Active Grants section ── */}
              {activeGrants.length > 0 && (
                <>
                  <SectionHeaderRow label="Active Grants" count={activeGrants.length} labelW={LABEL_W} />
                  {renderRows(activeGrants, true)}
                </>
              )}

              {/* ── Proposals section ── */}
              {proposals.length > 0 && (
                <>
                  <SectionHeaderRow label="Proposals" count={proposals.length} labelW={LABEL_W} />
                  {renderRows(proposals, activeGrants.length === 0)}
                </>
              )}

              {/* ── Other (rejected, archived, etc.) ── */}
              {otherGrants.length > 0 && (
                <>
                  <SectionHeaderRow label="Other" count={otherGrants.length} labelW={LABEL_W} />
                  {renderRows(otherGrants, activeGrants.length === 0 && proposals.length === 0)}
                </>
              )}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-3 border-t border-gray-50 flex flex-wrap gap-x-4 gap-y-1.5">
              {[
                { color: 'bg-red-200 border-red-300', label: 'Overdue' },
                { color: 'bg-amber-200 border-amber-300', label: '≤7 days' },
                { color: 'bg-amber-100 border-amber-200', label: '8–30 days' },
                { color: 'bg-emerald-100 border-emerald-200', label: '>30 days' },
                { color: 'bg-indigo-200 border-indigo-300', label: 'Starred' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className={`w-6 h-2.5 rounded-full border ${color}`} />
                  <span className="text-[10px] text-gray-400">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-2.5 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
                  <div className="w-px h-full bg-white/70" />
                </div>
                <span className="text-[10px] text-gray-400">Internal deadline</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
