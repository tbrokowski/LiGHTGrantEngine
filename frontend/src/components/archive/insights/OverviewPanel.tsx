'use client';
import { useMemo, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  type FxSettings, type GapKey, type InsightEntry, type InsightTag,
  OUTCOME_STACK, computeMetrics, findings, formatMoney, formatPct, yearTrend,
} from '@/lib/archiveStats';
import { CHART, ChartTooltipBox, EmptyNote, Kpi, SectionHeader, Segmented } from './ui';

type TrendMetric = 'count' | 'requested' | 'awarded';

export default function OverviewPanel({
  entries, tags, fx, onGap, onDimension,
}: {
  entries: InsightEntry[];
  tags: InsightTag[];
  fx: FxSettings;
  onGap: (gap: GapKey) => void;
  onDimension: (dim: string) => void;
}) {
  const [metric, setMetric] = useState<TrendMetric>('count');
  const money = (v: number | null | undefined) => formatMoney(v, fx.base);
  const m = useMemo(() => computeMetrics(entries, fx), [entries, fx]);
  const trend = useMemo(() => yearTrend(entries, fx), [entries, fx]);
  const notes = useMemo(() => findings(entries, tags, fx, v => formatMoney(v, fx.base)), [entries, tags, fx]);

  if (!entries.length) {
    return <EmptyNote>Select grants on the left to see statistics.</EmptyNote>;
  }

  const stackData = trend.map(r => ({
    label: r.label,
    ...(metric === 'count' ? r.counts : metric === 'requested' ? r.requestedBy : {}),
    awardedTotal: r.awarded,
    n: r.n,
  }));
  const rateData = trend.map(r => ({
    label: r.label,
    rate: r.winRate != null ? r.winRate * 100 : null,
    band: r.ci ? [r.ci[0] * 100, r.ci[1] * 100] : null,
    won: r.won,
    decided: r.decided,
  }));
  const fmtAxis = (v: number) => (metric === 'count' ? String(v) : formatMoney(v, fx.base));

  return (
    <div className="space-y-8">
      {/* KPIs */}
      <section>
        <div
          className="grid grid-cols-2 md:grid-cols-4"
          style={{ borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}
        >
          <Kpi emphasis label="Win rate" value={formatPct(m.winRate)}
            sub={m.ci ? `95% range ${formatPct(m.ci[0])}–${formatPct(m.ci[1])}` : 'No decisions yet'} />
          <Kpi emphasis label="Awarded" value={money(m.awarded)}
            sub={`${m.won} funded · ${m.awardedCount} with amounts`} />
          <Kpi emphasis label="Proposals" value={m.submitted}
            sub={`${m.decided} decided · ${m.open} pending`} />
          <Kpi emphasis label="Funding yield" value={m.yield != null ? formatPct(m.yield, 1) : '—'}
            sub={m.yield != null ? `awarded per ${fx.base} requested · ${m.yieldCoverage} grants` : 'Needs decided grants with amounts'} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          <Kpi label="Requested" value={money(m.requested)} sub={`${m.requestedCount} with amounts`} />
          <Kpi label="Median award" value={money(m.medianAward)}
            sub={m.meanAward != null ? `mean ${money(m.meanAward)}` : undefined} />
          <Kpi label="Time to decision" value={m.medianDays != null ? `${Math.round(m.medianDays)} d` : '—'}
            sub={m.daysCount ? `median of ${m.daysCount}` : 'Needs both dates'} />
          <Kpi label="Awaiting decision" value={money(m.pipeline)} sub={`${m.open} pending`} />
        </div>
      </section>

      {/* Findings */}
      {notes.length > 0 && (
        <section>
          <SectionHeader title="What stands out" hint="Computed from the selected grants. p-values use Fisher’s exact test." />
          <ul>
            {notes.map((f, i) => (
              <li key={i} className="flex items-start gap-3 py-2" style={{ borderTop: i ? '1px solid var(--rule-subtle)' : undefined }}>
                <FindingIcon tone={f.tone} />
                <span className="text-[13px] flex-1 leading-snug" style={{ color: 'var(--ink-secondary)' }}>{f.text}</span>
                {f.gap && (
                  <button type="button" onClick={() => onGap(f.gap!)} className="text-xs font-medium whitespace-nowrap hover:underline" style={{ color: 'var(--ink-primary)' }}>
                    Fill in →
                  </button>
                )}
                {!f.gap && f.dimension && (
                  <button type="button" onClick={() => onDimension(f.dimension!)} className="text-xs whitespace-nowrap hover:underline" style={{ color: 'var(--ink-muted)' }}>
                    Break down →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Trends */}
      {trend.length === 0 ? (
        <section>
          <SectionHeader title="Over time" />
          <EmptyNote>None of the selected grants has a call year or submission date.</EmptyNote>
        </section>
      ) : (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div>
            <SectionHeader
              title={metric === 'count' ? 'Proposals by year' : metric === 'requested' ? `Requested by year (${fx.base})` : `Awarded by year (${fx.base})`}
              hint={metric === 'awarded' ? 'Award amounts of funded grants' : 'Stacked by outcome'}
              right={(
                <Segmented size="sm" value={metric} onChange={setMetric} ariaLabel="Trend measure" options={[
                  { value: 'count', label: 'Count' },
                  { value: 'requested', label: 'Requested' },
                  { value: 'awarded', label: 'Awarded' },
                ]} />
              )}
            />
            {metric !== 'awarded' && <StackLegend />}
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stackData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: CHART.font, fill: CHART.tick }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: CHART.font, fill: CHART.tick }} axisLine={false} tickLine={false}
                    width={metric === 'count' ? 28 : 64} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as Record<string, number>;
                      if (metric === 'awarded') {
                        return <ChartTooltipBox title={label} rows={[{ label: 'Awarded', value: money(row.awardedTotal), color: OUTCOME_STACK[0].color }]} />;
                      }
                      return (
                        <ChartTooltipBox
                          title={`${label} · ${row.n} proposal${row.n === 1 ? '' : 's'}`}
                          rows={[...OUTCOME_STACK].reverse().filter(s => row[s.key]).map(s => ({
                            label: s.label, color: s.color,
                            value: metric === 'count' ? row[s.key] : money(row[s.key]),
                          }))}
                        />
                      );
                    }}
                  />
                  {metric === 'awarded' ? (
                    <Bar dataKey="awardedTotal" fill={OUTCOME_STACK[0].color} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  ) : (
                    OUTCOME_STACK.map(s => (
                      <Bar key={s.key} dataKey={s.key} stackId="o" fill={s.color} stroke="#FFFFFF" strokeWidth={1} maxBarSize={36} />
                    ))
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <SectionHeader title="Win rate by year" hint="Shaded band is the 95% range — wide when few decisions" />
            <div className="h-[18px] mb-2 flex items-center gap-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: CHART.series }} />Win rate</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2.5 rounded-[2px]" style={{ background: CHART.band }} />95% range</span>
              {m.winRate != null && (
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-px" style={{ background: CHART.ink }} />Overall {formatPct(m.winRate)}</span>
              )}
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rateData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: CHART.font, fill: CHART.tick }} axisLine={{ stroke: CHART.axis }} tickLine={false} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`}
                    tick={{ fontSize: CHART.font, fill: CHART.tick }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip
                    cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { rate: number | null; band: [number, number] | null; won: number; decided: number };
                      if (row.rate == null) return <ChartTooltipBox title={label} rows={[{ label: 'No decisions', value: '' }]} />;
                      return (
                        <ChartTooltipBox title={label} rows={[
                          { label: 'Win rate', value: `${Math.round(row.rate)}%`, color: CHART.series },
                          { label: '95% range', value: row.band ? `${Math.round(row.band[0])}–${Math.round(row.band[1])}%` : '—' },
                          { label: 'Funded / decided', value: `${row.won} / ${row.decided}` },
                        ]} />
                      );
                    }}
                  />
                  <Area dataKey="band" stroke="none" fill={CHART.band} isAnimationActive={false} connectNulls={false} />
                  {m.winRate != null && <ReferenceLine y={m.winRate * 100} stroke={CHART.ink} strokeWidth={1} strokeOpacity={0.5} />}
                  <Line dataKey="rate" stroke={CHART.series} strokeWidth={2} connectNulls={false}
                    dot={{ r: 4, fill: CHART.series, stroke: '#FFFFFF', strokeWidth: 2 }} activeDot={{ r: 5, stroke: '#FFFFFF', strokeWidth: 2 }}
                    isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function StackLegend() {
  return (
    <div className="h-[18px] mb-2 flex items-center gap-3 flex-wrap text-[11px]" style={{ color: 'var(--ink-muted)' }}>
      {OUTCOME_STACK.map(s => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  );
}

function FindingIcon({ tone }: { tone: 'up' | 'down' | 'neutral' | 'gap' }) {
  const common = 'w-4 h-4 mt-0.5 shrink-0';
  if (tone === 'up') {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" stroke={CHART.up} strokeWidth={1.8} aria-label="Positive">
        <path d="M3 11l4-4 2.5 2.5L13 6" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 6h3v3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'down') {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" stroke={CHART.down} strokeWidth={1.8} aria-label="Negative">
        <path d="M3 5l4 4 2.5-2.5L13 10" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 10h3V7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'gap') {
    return (
      <svg className={common} viewBox="0 0 16 16" fill="none" stroke="var(--state-warning)" strokeWidth={1.6} aria-label="Missing data">
        <path d="M8 2.5l6 10.5H2L8 2.5z" strokeLinejoin="round" /><path d="M8 7v2.5M8 11.2v.1" strokeLinecap="round" />
      </svg>
    );
  }
  return <span className="w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center" aria-hidden><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ink-faint)' }} /></span>;
}
