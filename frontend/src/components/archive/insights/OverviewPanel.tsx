'use client';
import { useMemo, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, ErrorBar, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  type ConfidenceSettings, type FxSettings, type GapKey, type InsightEntry, type InsightTag, type Metrics,
  OUTCOME_STACK, calibration, computeMetrics, findings, formatMoney, formatPct, yearTrend,
} from '@/lib/archiveStats';
import { CHART, ChartTooltipBox, EmptyNote, Kpi, SectionHeader, Segmented } from './ui';

type TrendMetric = 'count' | 'requested' | 'awarded';

export default function OverviewPanel({
  entries, tags, fx, conf, onConf, onGap, onDimension,
}: {
  entries: InsightEntry[];
  tags: InsightTag[];
  fx: FxSettings;
  conf: ConfidenceSettings;
  onConf: (c: ConfidenceSettings) => void;
  onGap: (gap: GapKey) => void;
  onDimension: (dim: string) => void;
}) {
  const [metric, setMetric] = useState<TrendMetric>('count');
  const [rateKind, setRateKind] = useState<'raw' | 'adjusted'>('raw');
  const money = (v: number | null | undefined) => formatMoney(v, fx.base);
  const m = useMemo(() => computeMetrics(entries, fx, conf), [entries, fx, conf]);
  const trend = useMemo(() => yearTrend(entries, fx, conf), [entries, fx, conf]);
  const notes = useMemo(() => findings(entries, tags, fx, v => formatMoney(v, fx.base), conf), [entries, tags, fx, conf]);

  if (!entries.length) {
    return <EmptyNote>Select grants on the left to see statistics.</EmptyNote>;
  }

  const stackData = trend.map(r => ({
    label: r.label,
    ...(metric === 'count' ? r.counts : metric === 'requested' ? r.requestedBy : {}),
    awardedTotal: r.awarded,
    n: r.n,
  }));
  const adjusted = rateKind === 'adjusted';
  const rateData = trend.map(r => {
    const rate = adjusted ? r.adjWinRate : r.winRate;
    const ci = adjusted ? r.adjCi : r.ci;
    return {
      label: r.label,
      rate: rate != null ? rate * 100 : null,
      band: ci ? [ci[0] * 100, ci[1] * 100] : null,
      won: r.won,
      decided: r.decided,
    };
  });
  const overallRate = adjusted ? m.adjWinRate : m.winRate;
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
          <Kpi emphasis label="Confidence-adjusted" value={formatPct(m.adjWinRate)}
            sub={m.decided
              ? (m.rated ? `${m.rated} of ${m.decided} decided rated${m.adjCi ? ` · ${formatPct(m.adjCi[0])}–${formatPct(m.adjCi[1])}` : ''}` : 'Rate your odds to weight long shots less')
              : 'No decisions yet'} />
          <Kpi emphasis label="Awarded" value={money(m.awarded)}
            sub={`${m.won} funded · ${m.awardedCount} with amounts`} />
          <Kpi emphasis label="Proposals" value={m.submitted}
            sub={`${m.decided} decided · ${m.open} pending`} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          <Kpi label="Funding yield" value={m.yield != null ? formatPct(m.yield, 1) : '—'}
            sub={m.yield != null ? `per ${fx.base} requested · ${m.yieldCoverage} grants` : 'Needs decided amounts'} />
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
            <SectionHeader
              title={adjusted ? 'Confidence-adjusted win rate by year' : 'Win rate by year'}
              hint={adjusted ? 'Each decision weighted by your odds at submission' : 'Shaded band is the 95% range — wide when few decisions'}
              right={(
                <Segmented size="sm" value={rateKind} onChange={setRateKind} ariaLabel="Win rate kind" options={[
                  { value: 'raw', label: 'Raw' },
                  { value: 'adjusted', label: 'Adjusted', title: 'Weighted by your odds at submission' },
                ]} />
              )}
            />
            <div className="h-[18px] mb-2 flex items-center gap-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: CHART.series }} />Win rate</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2.5 rounded-[2px]" style={{ background: CHART.band }} />95% range</span>
              {overallRate != null && (
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-px" style={{ background: CHART.ink }} />Overall {formatPct(overallRate)}</span>
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
                          { label: adjusted ? 'Adjusted win rate' : 'Win rate', value: `${Math.round(row.rate)}%`, color: CHART.series },
                          { label: '95% range', value: row.band ? `${Math.round(row.band[0])}–${Math.round(row.band[1])}%` : '—' },
                          { label: 'Funded / decided', value: `${row.won} / ${row.decided}` },
                        ]} />
                      );
                    }}
                  />
                  <Area dataKey="band" stroke="none" fill={CHART.band} isAnimationActive={false} connectNulls={false} />
                  {overallRate != null && <ReferenceLine y={overallRate * 100} stroke={CHART.ink} strokeWidth={1} strokeOpacity={0.5} />}
                  <Line dataKey="rate" stroke={CHART.series} strokeWidth={2} connectNulls={false}
                    dot={{ r: 4, fill: CHART.series, stroke: '#FFFFFF', strokeWidth: 2 }} activeDot={{ r: 5, stroke: '#FFFFFF', strokeWidth: 2 }}
                    isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      <OddsSection entries={entries} m={m} conf={conf} onConf={onConf} onGap={() => onGap('confidence')} />
    </div>
  );
}

const BRIER_COIN_FLIP = 0.25;

function brierNote(b: number): string {
  if (b < 0.1) return 'sharp and well calibrated';
  if (b < 0.2) return 'better than guessing 50/50';
  if (b <= 0.27) return 'about as good as guessing 50/50';
  return 'worse than guessing 50/50';
}

/** How the team's own odds compared with what happened. */
function OddsSection({ entries, m, conf, onConf, onGap }: {
  entries: InsightEntry[];
  m: Metrics;
  conf: ConfidenceSettings;
  onConf: (c: ConfidenceSettings) => void;
  onGap: () => void;
}) {
  const bins = useMemo(() => calibration(entries), [entries]);
  const unratedDecided = m.decided - m.rated;
  const data = bins.map(b => ({
    label: b.label,
    actual: b.actual != null ? b.actual * 100 : null,
    stated: b.stated != null ? b.stated * 100 : null,
    err: b.actual != null && b.ci ? [b.actual * 100 - b.ci[0] * 100, b.ci[1] * 100 - b.actual * 100] : null,
    n: b.n,
    won: b.won,
  }));
  const ratio = m.expectedWins ? m.ratedWins / m.expectedWins : null;

  return (
    <section>
      <SectionHeader
        title="Your odds vs results"
        hint="Rate each grant’s odds at submission (left rail → Set odds, or the Data tab). Long shots then count less in the adjusted win rate."
        right={(
          <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Unrated grants count as
            <select value={conf.unrated} onChange={e => onConf({ unrated: Number(e.target.value) })}
              className="px-1.5 py-0.5 text-[11px] mono-data" style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', color: 'var(--ink-primary)' }}>
              {[100, 75, 50, 25, 0].map(v => <option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
        )}
      />
      {m.rated === 0 ? (
        <div className="py-6 px-4 text-xs text-center" style={{ color: 'var(--ink-muted)', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)' }}>
          None of the decided grants here has odds yet.
          {m.decided > 0 && (
            <button type="button" onClick={onGap} className="ml-1 font-medium hover:underline" style={{ color: 'var(--ink-primary)' }}>
              Rate {m.decided} decided grant{m.decided === 1 ? '' : 's'} →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)] gap-8">
          <dl className="text-xs">
            <OddsRow label="Expected wins" value={m.expectedWins != null ? m.expectedWins.toFixed(1) : '—'} sub={`sum of your odds on ${m.rated} rated decided grant${m.rated === 1 ? '' : 's'}`} />
            <OddsRow label="Actual wins" value={String(m.ratedWins)}
              sub={ratio != null ? `${ratio.toFixed(2)}× your own expectation${ratio >= 1.15 ? ' — beating your odds' : ratio <= 0.85 ? ' — below your odds' : ''}` : undefined} />
            <OddsRow label="Brier score" value={m.brier != null ? m.brier.toFixed(3) : '—'}
              sub={m.brier != null ? `${brierNote(m.brier)} (0 is perfect; a 50/50 guess on every grant scores ${BRIER_COIN_FLIP})` : undefined} />
            <OddsRow label="Unrated" value={String(unratedDecided)}
              sub={unratedDecided ? `decided grant${unratedDecided === 1 ? '' : 's'} counted at ${conf.unrated}% weight` : 'every decided grant is rated'}
              action={unratedDecided ? { label: 'Rate them →', onClick: onGap } : undefined} />
          </dl>
          <div>
            <div className="h-[18px] mb-2 flex items-center gap-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: CHART.series }} />Actually won</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: CHART.ink }} />What you predicted</span>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 6, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: CHART.font, fill: CHART.tick }} axisLine={{ stroke: CHART.axis }} tickLine={false}
                    label={{ value: 'Odds you gave at submission', position: 'insideBottom', offset: 0, fontSize: 10, fill: CHART.tick }} height={40} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`}
                    tick={{ fontSize: CHART.font, fill: CHART.tick }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { actual: number | null; stated: number | null; n: number; won: number };
                      if (!row.n) return <ChartTooltipBox title={`Rated ${label}`} rows={[{ label: 'No decided grants', value: '' }]} />;
                      return (
                        <ChartTooltipBox title={`Rated ${label}`} rows={[
                          { label: 'Actually won', value: `${Math.round(row.actual!)}% (${row.won}/${row.n})`, color: CHART.series },
                          { label: 'You predicted', value: `${Math.round(row.stated!)}%`, color: CHART.ink },
                        ]} />
                      );
                    }}
                  />
                  <Bar dataKey="actual" fill={CHART.series} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                    <ErrorBar dataKey="err" width={5} strokeWidth={1.25} stroke={CHART.ink} direction="y" />
                  </Bar>
                  <Line dataKey="stated" stroke={CHART.ink} strokeWidth={2} connectNulls
                    dot={{ r: 4, fill: '#FFFFFF', stroke: CHART.ink, strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10.5px] mt-1" style={{ color: 'var(--ink-muted)' }}>
              Bars above the line mean you won more often than you expected in that band. Whiskers show the 95% range.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function OddsRow({ label, value, sub, action }: { label: string; value: string; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="py-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="ledger-label">{label}</dt>
        <dd className="mono-data tabular-nums text-[15px] font-semibold" style={{ color: 'var(--ink-primary)' }}>{value}</dd>
      </div>
      {(sub || action) && (
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          {sub && <span className="text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>{sub}</span>}
          {action && (
            <button type="button" onClick={action.onClick} className="text-[11px] font-medium whitespace-nowrap hover:underline" style={{ color: 'var(--ink-primary)' }}>
              {action.label}
            </button>
          )}
        </div>
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
