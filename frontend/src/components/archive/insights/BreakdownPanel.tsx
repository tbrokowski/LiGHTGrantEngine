'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  type FxSettings, type InsightEntry, type InsightTag, type SegmentStats,
  breakdown, dimensionOptions, downloadCsv, formatMoney, formatP, formatPct, toCsv,
} from '@/lib/archiveStats';
import { CHART, ChartTooltipBox, EmptyNote, GhostButton, SectionHeader, Segmented, TagDot, inputStyle } from './ui';

export type ChartMetric = 'winRate' | 'count' | 'awarded' | 'requested' | 'yield';

const METRICS: { value: ChartMetric; label: string }[] = [
  { value: 'winRate', label: 'Win rate' },
  { value: 'count', label: 'Proposals' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'requested', label: 'Requested' },
  { value: 'yield', label: 'Yield' },
];

type SortKey = 'label' | 'n' | 'decided' | 'won' | 'winRate' | 'delta' | 'requested' | 'awarded' | 'yield' | 'medianAward' | 'medianDays';

const CHART_LIMIT = 15;

export default function BreakdownPanel({
  entries, tags, fx, dimension, onDimension, metric, onMetric, onSelectOnly,
}: {
  entries: InsightEntry[];
  tags: InsightTag[];
  fx: FxSettings;
  dimension: string;
  onDimension: (d: string) => void;
  metric: ChartMetric;
  onMetric: (m: ChartMetric) => void;
  onSelectOnly: (ids: string[]) => void;
}) {
  const [minDecided, setMinDecided] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const money = (v: number | null | undefined) => formatMoney(v, fx.base);

  const options = useMemo(() => dimensionOptions(tags), [tags]);
  const dimLabel = options.find(o => o.key === dimension)?.label ?? dimension;
  const all = useMemo(() => breakdown(entries, dimension, tags, fx), [entries, dimension, tags, fx]);
  const rows = useMemo(() => all.filter(s => s.metrics.decided >= minDecided), [all, minDecided]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const val = (s: SegmentStats): number | string => {
      switch (sort.key) {
        case 'label': return s.label.toLowerCase();
        case 'n': return s.metrics.n;
        case 'decided': return s.metrics.decided;
        case 'won': return s.metrics.won;
        case 'winRate': return s.metrics.winRate ?? -1;
        case 'delta': return s.delta ?? -9;
        case 'requested': return s.metrics.requested;
        case 'awarded': return s.metrics.awarded;
        case 'yield': return s.metrics.yield ?? -1;
        case 'medianAward': return s.metrics.medianAward ?? -1;
        case 'medianDays': return s.metrics.medianDays ?? 1e9;
      }
    };
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);

  const metricValue = (s: SegmentStats): number | null => {
    switch (metric) {
      case 'winRate': return s.metrics.winRate != null ? s.metrics.winRate * 100 : null;
      case 'count': return s.metrics.n;
      case 'awarded': return s.metrics.awarded;
      case 'requested': return s.metrics.requested;
      case 'yield': return s.metrics.yield != null ? s.metrics.yield * 100 : null;
    }
  };

  const chartRows = sorted.slice(0, CHART_LIMIT).map(s => {
    const v = metricValue(s);
    const ci = s.metrics.ci;
    return {
      key: s.key,
      label: s.label.length > 28 ? `${s.label.slice(0, 27)}…` : s.label,
      full: s.label,
      value: v,
      // null (not [0, 0]) so recharts skips the whisker instead of drawing duplicate zero-length lines.
      err: metric === 'winRate' && v != null && ci ? [v - ci[0] * 100, ci[1] * 100 - v] : null,
      s,
    };
  });
  const fmtValue = (v: number | null) => {
    if (v == null) return '—';
    if (metric === 'winRate' || metric === 'yield') return `${Math.round(v)}%`;
    if (metric === 'count') return String(v);
    return money(v);
  };

  function exportCsv() {
    const header = ['Segment', 'Proposals', 'Decided', 'Won', 'Win rate', 'Win rate low (95%)', 'Win rate high (95%)',
      'Difference vs rest (pts)', 'p-value', `Requested (${fx.base})`, `Awarded (${fx.base})`, 'Yield', `Median award (${fx.base})`, 'Median days to decision'];
    const body = sorted.map(s => [
      s.label, s.metrics.n, s.metrics.decided, s.metrics.won,
      s.metrics.winRate != null ? (s.metrics.winRate * 100).toFixed(1) : '',
      s.metrics.ci ? (s.metrics.ci[0] * 100).toFixed(1) : '', s.metrics.ci ? (s.metrics.ci[1] * 100).toFixed(1) : '',
      s.delta != null ? (s.delta * 100).toFixed(1) : '', s.p != null ? s.p.toFixed(4) : '',
      Math.round(s.metrics.requested), Math.round(s.metrics.awarded),
      s.metrics.yield != null ? (s.metrics.yield * 100).toFixed(1) : '',
      s.metrics.medianAward != null ? Math.round(s.metrics.medianAward) : '',
      s.metrics.medianDays ?? '',
    ]);
    downloadCsv(`archive-breakdown-${dimLabel.toLowerCase().replace(/\s+/g, '-')}.csv`, toCsv([header, ...body]));
  }

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th className={`px-3 py-2 ledger-label whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => setSort(prev => (prev?.key === key ? (prev.dir === -1 ? { key, dir: 1 } : null) : { key, dir: key === 'label' ? 1 : -1 }))}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        {sort?.key === key && <span aria-hidden>{sort.dir === -1 ? '↓' : '↑'}</span>}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Break down by
          <select value={dimension} onChange={e => onDimension(e.target.value)} className="px-2 py-1 text-xs font-medium" style={inputStyle}>
            {(['Tags', 'Grant fields'] as const).map(section => {
              const opts = options.filter(o => o.section === section);
              if (!opts.length) return null;
              return (
                <optgroup key={section} label={section === 'Tags' ? 'Tag groups' : 'Grant fields'}>
                  {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </optgroup>
              );
            })}
          </select>
        </label>
        <Segmented value={metric} onChange={onMetric} options={METRICS} size="sm" ariaLabel="Chart measure" />
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Min. decided
          <select value={minDecided} onChange={e => setMinDecided(Number(e.target.value))} className="px-2 py-1 text-xs" style={inputStyle}>
            {[0, 1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="ml-auto">
          <GhostButton onClick={exportCsv} disabled={!sorted.length} title="Download this table as CSV">Export CSV</GhostButton>
        </div>
      </div>

      {!tags.length && dimension === 'funder' && (
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Tip: tag grants (e.g. <em>Stage: EOI</em>, <em>Programme: Horizon Europe</em>) to break down by your own categories.
        </p>
      )}

      {sorted.length === 0 ? (
        <EmptyNote>No segments to show{minDecided ? ` with at least ${minDecided} decided` : ''}.</EmptyNote>
      ) : (
        <>
          <section>
            <SectionHeader
              title={`${METRICS.find(m => m.value === metric)!.label} by ${dimLabel.toLowerCase()}`}
              hint={metric === 'winRate' ? 'Whiskers show the 95% range; segments with few decisions are uncertain'
                : metric === 'yield' ? `Awarded per ${fx.base} requested, over decided grants with amounts`
                : sorted.length > CHART_LIMIT ? `First ${CHART_LIMIT} of ${sorted.length} — the table has all` : undefined}
            />
            <div style={{ height: Math.max(120, chartRows.length * 30 + 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={CHART.grid} />
                  <XAxis type="number" tickFormatter={v => fmtValue(v)} tick={{ fontSize: CHART.font, fill: CHART.tick }}
                    axisLine={{ stroke: CHART.axis }} tickLine={false}
                    domain={metric === 'winRate' ? [0, 100] : [0, 'auto']} />
                  <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: CHART.font, fill: CHART.ink }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const s = (payload[0].payload as { s: SegmentStats }).s;
                      return (
                        <ChartTooltipBox title={s.label} rows={[
                          { label: 'Proposals', value: s.metrics.n },
                          { label: 'Funded / decided', value: `${s.metrics.won} / ${s.metrics.decided}` },
                          { label: 'Win rate', value: s.metrics.winRate != null ? `${formatPct(s.metrics.winRate)} (${formatPct(s.metrics.ci![0])}–${formatPct(s.metrics.ci![1])})` : '—' },
                          { label: 'vs everything else', value: s.delta != null ? `${s.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(s.delta * 100))} pts · p ${formatP(s.p)}` : '—' },
                          { label: 'Awarded', value: money(s.metrics.awarded) },
                          { label: 'Requested', value: money(s.metrics.requested) },
                        ]} />
                      );
                    }}
                  />
                  <Bar dataKey="value" fill={CHART.series} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                    {metric === 'winRate' && <ErrorBar dataKey="err" width={5} strokeWidth={1.25} stroke={CHART.ink} direction="x" />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
                  {th('label', dimLabel, 'left')}
                  {th('n', 'Proposals')}
                  {th('won', 'Won')}
                  {th('winRate', 'Win rate')}
                  {th('delta', 'vs rest')}
                  {th('requested', 'Requested')}
                  {th('awarded', 'Awarded')}
                  {th('yield', 'Yield')}
                  {th('medianAward', 'Median award')}
                  {th('medianDays', 'Days to decision')}
                  <th className="px-2 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const m = s.metrics;
                  const thin = m.decided < 3;
                  const sig = s.p != null && s.p < 0.05;
                  return (
                    <tr key={s.key} className="group" style={{ borderBottom: '1px solid var(--rule-subtle)', color: s.muted ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}>
                      <td className="px-3 py-2 max-w-[240px]">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {s.color && <TagDot color={s.color} />}
                          <span className="truncate font-medium" style={{ color: s.muted ? 'var(--ink-muted)' : 'var(--ink-primary)' }} title={s.label}>{s.label}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{m.n}</td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{m.won}<span style={{ color: 'var(--ink-faint)' }}>/{m.decided}</span></td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums whitespace-nowrap" style={{ opacity: thin ? 0.6 : 1 }}>
                        {formatPct(m.winRate)}
                        {m.ci && <span className="ml-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>{Math.round(m.ci[0] * 100)}–{Math.round(m.ci[1] * 100)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums whitespace-nowrap" title={s.p != null ? `Fisher exact p = ${formatP(s.p)}` : undefined}>
                        {s.delta == null ? '—' : (
                          <span style={{ fontWeight: sig ? 600 : 400, color: sig ? (s.delta > 0 ? CHART.up : CHART.down) : undefined }}>
                            {s.delta >= 0 ? '+' : '−'}{Math.abs(Math.round(s.delta * 100))}
                            <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--ink-muted)' }}>p {formatP(s.p)}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{money(m.requested)}</td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums whitespace-nowrap">
                        {money(m.awarded)}
                        {m.won > m.awardedCount && (
                          <span className="ml-1" style={{ color: 'var(--state-warning)' }}
                            title={`${m.won - m.awardedCount} funded grant${m.won - m.awardedCount === 1 ? ' has' : 's have'} no award amount — fill it in on the Data tab`}>
                            +?
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{formatPct(m.yield)}</td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{money(m.medianAward)}</td>
                      <td className="px-3 py-2 text-right mono-data tabular-nums">{m.medianDays != null ? Math.round(m.medianDays) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectOnly(s.entries.map(e => e.id))}
                          className="text-[11px] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:underline"
                          style={{ color: 'var(--ink-muted)' }}
                          title="Narrow the analysis to just these grants"
                        >
                          Analyze only these
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10.5px] mt-2" style={{ color: 'var(--ink-muted)' }}>
              “vs rest” compares the segment’s win rate with every other selected grant, in percentage points; bold when Fisher’s exact p &lt; 0.05.
              Win rates with fewer than 3 decisions are faded. A grant with several tags counts in each.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
