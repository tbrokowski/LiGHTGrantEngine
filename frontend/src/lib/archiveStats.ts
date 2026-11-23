/**
 * Archive Insights statistics engine.
 *
 * Pure functions over the archive dataset: nothing here touches the network,
 * so selecting grants or switching a breakdown recomputes instantly.
 *
 * Definitions
 *   won      awarded, partially_funded
 *   lost     rejected
 *   open     pending, deferred (no decision yet)
 *   other    withdrawn, resubmitted, not_submitted, no outcome recorded
 *   win rate won / (won + lost), with a 95% Wilson interval
 *   yield    Σ awarded / Σ requested over decided grants whose amounts are
 *            known ("for every 1 requested, how much came back")
 * Money is converted to one base currency with editable rates.
 */

// ── Dataset types ────────────────────────────────────────────────────────────

export interface InsightEntry {
  id: string;
  title: string;
  funder: string | null;
  program: string | null;
  call_year: number | null;
  submission_cycle: string | null;
  lead_pi: string | null;
  co_pis: string[];
  partner_institutions: string[];
  themes: string[];
  geographies: string[];
  submitted: boolean | null;
  submission_date: string | null;
  outcome: string | null;
  decision_date: string | null;
  requested_amount: number | null;
  awarded_amount: number | null;
  currency: string | null;
  project_duration: string | null;
  created_at: string | null;
  tag_ids: string[];
}

export interface InsightTag {
  id: string;
  name: string;
  group: string;
  color: string;
  usage: number;
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

export const OUTCOME_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'partially_funded', label: 'Partially funded' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'resubmitted', label: 'Resubmitted' },
  { value: 'not_submitted', label: 'Not submitted' },
] as const;

export function outcomeLabel(o: string | null | undefined): string {
  if (!o) return 'No outcome';
  return OUTCOME_OPTIONS.find(x => x.value === o)?.label ?? o;
}

export type OutcomeClass = 'won' | 'lost' | 'open' | 'other';

export function outcomeClass(o: string | null | undefined): OutcomeClass {
  switch (o) {
    case 'awarded':
    case 'partially_funded':
      return 'won';
    case 'rejected':
      return 'lost';
    case 'pending':
    case 'deferred':
      return 'open';
    default:
      return 'other';
  }
}

/** Stack segments for outcome-mix charts, bottom to top. */
export const OUTCOME_STACK = [
  { key: 'awarded', label: 'Awarded', color: '#008300' },
  { key: 'partial', label: 'Partially funded', color: '#1baf7a' },
  { key: 'open', label: 'Pending', color: '#eda100' },
  { key: 'rejected', label: 'Rejected', color: '#e34948' },
  { key: 'other', label: 'Withdrawn / other', color: '#C4C3BB' },
] as const;
export type StackKey = typeof OUTCOME_STACK[number]['key'];

export function stackKey(o: string | null | undefined): StackKey {
  if (o === 'awarded') return 'awarded';
  if (o === 'partially_funded') return 'partial';
  if (o === 'rejected') return 'rejected';
  if (o === 'pending' || o === 'deferred') return 'open';
  return 'other';
}

const isSubmitted = (e: InsightEntry) => e.outcome !== 'not_submitted';

// ── Currency ─────────────────────────────────────────────────────────────────

/** Approximate USD value of one unit of each currency. Editable in the UI. */
export const DEFAULT_USD_RATES: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.13, CAD: 0.72, AUD: 0.65, NZD: 0.6,
  JPY: 0.0066, CNY: 0.14, SGD: 0.75, HKD: 0.128, INR: 0.012, SEK: 0.095,
  NOK: 0.093, DKK: 0.145, ZAR: 0.055, KES: 0.0077, NGN: 0.00065, BRL: 0.18,
  MXN: 0.055,
};

export interface FxSettings {
  base: string;
  /** USD per one unit of the currency. */
  usd: Record<string, number>;
}

export const DEFAULT_FX: FxSettings = { base: 'USD', usd: { ...DEFAULT_USD_RATES } };

const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR' };

export function normalizeCurrency(c: string | null | undefined): string | null {
  const t = (c ?? '').trim();
  if (!t) return null;
  return CURRENCY_SYMBOLS[t] ?? t.toUpperCase();
}

/** `amount` in the base currency; null if unknown or there's no rate for it.
 *  A missing currency is read as the base currency. */
export function convert(amount: number | null | undefined, currency: string | null | undefined, fx: FxSettings): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const cur = normalizeCurrency(currency) ?? fx.base;
  if (cur === fx.base) return amount;
  const from = fx.usd[cur];
  const to = fx.usd[fx.base];
  if (!from || !to) return null;
  return (amount * from) / to;
}

// ── Small statistics ─────────────────────────────────────────────────────────

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** 95% Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const _logFact: number[] = [0];
function logFact(n: number): number {
  for (let i = _logFact.length; i <= n; i++) _logFact[i] = _logFact[i - 1] + Math.log(i);
  return _logFact[n];
}

/** Two-sided Fisher exact test p-value for the 2×2 table [[a, b], [c, d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = a + b + c + d;
  if (n === 0 || r1 === 0 || r2 === 0 || c1 === 0 || c1 === n) return 1;
  const base = logFact(r1) + logFact(r2) + logFact(c1) + logFact(n - c1) - logFact(n);
  const prob = (x: number) => Math.exp(base - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(r2 - c1 + x));
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

// ── Per-entry helpers ────────────────────────────────────────────────────────

export function yearOf(e: InsightEntry): number | null {
  if (e.call_year) return e.call_year;
  if (e.submission_date) return Number(e.submission_date.slice(0, 4)) || null;
  return null;
}

export function daysToDecision(e: InsightEntry): number | null {
  if (!e.submission_date || !e.decision_date) return null;
  const ms = Date.parse(e.decision_date) - Date.parse(e.submission_date);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86_400_000);
}

// ── Data gaps ────────────────────────────────────────────────────────────────

export const GAPS = [
  { key: 'requested', label: 'Requested amount', hint: 'Submitted grants with no requested amount' },
  { key: 'awarded', label: 'Award amount', hint: 'Awarded grants with no award amount — totals are understated' },
  { key: 'currency', label: 'Currency', hint: 'Amounts with no currency (read as the base currency)' },
  { key: 'outcome', label: 'Outcome', hint: 'No outcome recorded' },
  { key: 'year', label: 'Year', hint: 'No call year or submission date' },
  { key: 'decision_date', label: 'Decision date', hint: 'Decided grants with no decision date' },
  { key: 'submission_date', label: 'Submission date', hint: 'Submitted grants with no submission date' },
  { key: 'funder', label: 'Funder', hint: 'No funder recorded' },
] as const;
export type GapKey = typeof GAPS[number]['key'];

export function gapsOf(e: InsightEntry): GapKey[] {
  const cls = outcomeClass(e.outcome);
  const out: GapKey[] = [];
  if (isSubmitted(e) && e.requested_amount == null) out.push('requested');
  if (cls === 'won' && e.awarded_amount == null) out.push('awarded');
  if ((e.requested_amount != null || e.awarded_amount != null) && !normalizeCurrency(e.currency)) out.push('currency');
  if (!e.outcome) out.push('outcome');
  if (yearOf(e) == null) out.push('year');
  if ((cls === 'won' || cls === 'lost') && !e.decision_date) out.push('decision_date');
  if (isSubmitted(e) && !e.submission_date) out.push('submission_date');
  if (!e.funder?.trim()) out.push('funder');
  return out;
}

export function gapCounts(entries: InsightEntry[]): Record<GapKey, number> {
  const counts = Object.fromEntries(GAPS.map(g => [g.key, 0])) as Record<GapKey, number>;
  for (const e of entries) for (const g of gapsOf(e)) counts[g] += 1;
  return counts;
}

// ── Cohort metrics ───────────────────────────────────────────────────────────

export interface Metrics {
  n: number;
  submitted: number;
  won: number;
  lost: number;
  open: number;
  other: number;
  decided: number;
  winRate: number | null;
  ci: [number, number] | null;
  requested: number;
  requestedCount: number;
  awarded: number;
  awardedCount: number;
  /** Σ awarded / Σ requested over decided grants with known amounts. */
  yield: number | null;
  yieldCoverage: number;
  medianAward: number | null;
  meanAward: number | null;
  medianRequest: number | null;
  medianDays: number | null;
  daysCount: number;
  /** Requested amount still awaiting a decision. */
  pipeline: number;
  /** Amounts left out because their currency has no rate. */
  unconverted: number;
  unconvertedCurrencies: string[];
}

export function computeMetrics(entries: InsightEntry[], fx: FxSettings): Metrics {
  let won = 0, lost = 0, open = 0, other = 0, submitted = 0;
  const requests: number[] = [];
  const awards: number[] = [];
  const days: number[] = [];
  let pipeline = 0;
  let yieldReq = 0, yieldAw = 0, yieldN = 0;
  let unconverted = 0;
  const missingRates = new Set<string>();

  const conv = (amt: number | null, cur: string | null) => {
    const v = convert(amt, cur, fx);
    if (amt != null && v == null) {
      unconverted += 1;
      const c = normalizeCurrency(cur);
      if (c) missingRates.add(c);
    }
    return v;
  };

  for (const e of entries) {
    const cls = outcomeClass(e.outcome);
    if (cls === 'won') won++;
    else if (cls === 'lost') lost++;
    else if (cls === 'open') open++;
    else other++;
    if (isSubmitted(e)) submitted++;

    const req = isSubmitted(e) ? conv(e.requested_amount, e.currency) : null;
    const aw = cls === 'won' ? conv(e.awarded_amount, e.currency) : null;
    if (req != null) requests.push(req);
    if (aw != null) awards.push(aw);
    if (cls === 'open' && req != null) pipeline += req;

    if ((cls === 'won' || cls === 'lost') && req != null && req > 0) {
      if (cls === 'lost') { yieldReq += req; yieldN++; }
      else if (aw != null) { yieldReq += req; yieldAw += aw; yieldN++; }
    }
    if (cls === 'won' || cls === 'lost') {
      const d = daysToDecision(e);
      if (d != null) days.push(d);
    }
  }

  const decided = won + lost;
  return {
    n: entries.length,
    submitted,
    won, lost, open, other, decided,
    winRate: decided ? won / decided : null,
    ci: wilson(won, decided),
    requested: sum(requests),
    requestedCount: requests.length,
    awarded: sum(awards),
    awardedCount: awards.length,
    yield: yieldReq > 0 ? yieldAw / yieldReq : null,
    yieldCoverage: yieldN,
    medianAward: median(awards),
    meanAward: awards.length ? sum(awards) / awards.length : null,
    medianRequest: median(requests),
    medianDays: median(days),
    daysCount: days.length,
    pipeline,
    unconverted,
    unconvertedCurrencies: [...missingRates].sort(),
  };
}

// ── Breakdowns ───────────────────────────────────────────────────────────────

export interface DimensionOption {
  key: string;
  label: string;
  section: 'Tags' | 'Grant fields';
}

export function dimensionOptions(tags: InsightTag[]): DimensionOption[] {
  const groups = [...new Set(tags.map(t => t.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [
    ...groups.map(g => ({ key: `group:${g}`, label: g, section: 'Tags' as const })),
    ...(tags.length ? [{ key: 'tags', label: 'Every tag', section: 'Tags' as const }] : []),
    { key: 'funder', label: 'Funder', section: 'Grant fields' },
    { key: 'year', label: 'Year', section: 'Grant fields' },
    { key: 'size', label: 'Request size', section: 'Grant fields' },
    { key: 'outcome', label: 'Outcome', section: 'Grant fields' },
    { key: 'lead_pi', label: 'Lead PI', section: 'Grant fields' },
    { key: 'program', label: 'Programme', section: 'Grant fields' },
    { key: 'theme', label: 'Theme', section: 'Grant fields' },
    { key: 'geography', label: 'Geography', section: 'Grant fields' },
    { key: 'currency', label: 'Currency', section: 'Grant fields' },
  ];
}

export interface Segment {
  key: string;
  label: string;
  color?: string;
  /** Natural position for ordered dimensions (year, size); undefined = sort by size. */
  order?: number;
  muted?: boolean;
  entries: InsightEntry[];
}

const SIZE_BANDS = [
  { max: 50_000, label: 'Under 50k' },
  { max: 250_000, label: '50k – 250k' },
  { max: 1_000_000, label: '250k – 1M' },
  { max: 5_000_000, label: '1M – 5M' },
  { max: Infinity, label: '5M and over' },
];

function bucket(entries: InsightEntry[], keyOf: (e: InsightEntry) => string[], labelOf?: (k: string) => string): Segment[] {
  const map = new Map<string, InsightEntry[]>();
  for (const e of entries) {
    for (const k of keyOf(e)) {
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
  }
  return [...map.entries()].map(([key, es]) => ({ key, label: labelOf ? labelOf(key) : key, entries: es }));
}

const NONE = '__none';

export function segmentsFor(entries: InsightEntry[], dim: string, tags: InsightTag[], fx: FxSettings): Segment[] {
  const tagById = new Map(tags.map(t => [t.id, t]));

  if (dim === 'tags' || dim.startsWith('group:')) {
    const group = dim.startsWith('group:') ? dim.slice(6) : null;
    const pool = tags.filter(t => group == null || t.group === group);
    const poolIds = new Set(pool.map(t => t.id));
    const segs: Segment[] = pool.map(t => ({
      key: t.id,
      label: t.name,
      color: t.color,
      entries: entries.filter(e => e.tag_ids.includes(t.id)),
    }));
    const none = entries.filter(e => !e.tag_ids.some(id => poolIds.has(id) && tagById.has(id)));
    if (none.length) segs.push({ key: NONE, label: group ? `No ${group} tag` : 'No tags', muted: true, entries: none });
    return segs.filter(s => s.entries.length);
  }

  switch (dim) {
    case 'funder':
      return bucket(entries, e => [e.funder?.trim() || NONE], k => (k === NONE ? 'No funder' : k));
    case 'year': {
      const segs = bucket(entries, e => [String(yearOf(e) ?? NONE)], k => (k === NONE ? 'No year' : k));
      return segs.map(s => ({ ...s, order: s.key === NONE ? 1e9 : Number(s.key), muted: s.key === NONE }));
    }
    case 'size': {
      const segs = bucket(entries, e => {
        const v = convert(e.requested_amount, e.currency, fx);
        if (v == null) return [NONE];
        return [String(SIZE_BANDS.findIndex(b => v < b.max))];
      }, k => (k === NONE ? 'No requested amount' : SIZE_BANDS[Number(k)].label));
      return segs.map(s => ({ ...s, order: s.key === NONE ? 99 : Number(s.key), muted: s.key === NONE }));
    }
    case 'outcome':
      return bucket(entries, e => [e.outcome || NONE], k => outcomeLabel(k === NONE ? null : k));
    case 'lead_pi':
      return bucket(entries, e => [e.lead_pi?.trim() || NONE], k => (k === NONE ? 'No lead PI' : k));
    case 'program':
      return bucket(entries, e => [e.program?.trim() || NONE], k => (k === NONE ? 'No programme' : k));
    case 'currency':
      return bucket(entries, e => [normalizeCurrency(e.currency) || NONE], k => (k === NONE ? 'No currency' : k));
    case 'theme':
      return bucket(entries, e => (e.themes?.length ? [...new Set(e.themes.map(t => t.trim()).filter(Boolean))] : [NONE]),
        k => (k === NONE ? 'No themes' : k));
    case 'geography':
      return bucket(entries, e => (e.geographies?.length ? [...new Set(e.geographies.map(t => t.trim()).filter(Boolean))] : [NONE]),
        k => (k === NONE ? 'No geography' : k));
    default:
      return [];
  }
}

export interface SegmentStats extends Segment {
  metrics: Metrics;
  /** Win-rate difference vs. every other grant in the cohort, in [−1, 1]. */
  delta: number | null;
  /** Fisher exact p-value for that difference. */
  p: number | null;
}

export function breakdown(entries: InsightEntry[], dim: string, tags: InsightTag[], fx: FxSettings): SegmentStats[] {
  return segmentsFor(entries, dim, tags, fx).map(seg => {
    const m = computeMetrics(seg.entries, fx);
    const ids = new Set(seg.entries.map(e => e.id));
    const rest = entries.filter(e => !ids.has(e.id));
    let restWon = 0, restLost = 0;
    for (const e of rest) {
      const c = outcomeClass(e.outcome);
      if (c === 'won') restWon++;
      else if (c === 'lost') restLost++;
    }
    const restDecided = restWon + restLost;
    const comparable = m.decided > 0 && restDecided > 0;
    return {
      ...seg,
      metrics: m,
      delta: comparable ? m.winRate! - restWon / restDecided : null,
      p: comparable ? fisherExact(m.won, m.lost, restWon, restLost) : null,
    };
  }).sort((a, b) => {
    if (a.order != null || b.order != null) return (a.order ?? 1e12) - (b.order ?? 1e12);
    if (!!a.muted !== !!b.muted) return a.muted ? 1 : -1;
    return b.metrics.n - a.metrics.n || a.label.localeCompare(b.label);
  });
}

// ── Tag lift ─────────────────────────────────────────────────────────────────

export interface TagLift {
  tag: InsightTag;
  n: number;
  withWon: number;
  withDecided: number;
  withRate: number | null;
  withoutWon: number;
  withoutDecided: number;
  withoutRate: number | null;
  delta: number | null;
  p: number | null;
  awarded: number;
}

export function tagLift(entries: InsightEntry[], tags: InsightTag[], fx: FxSettings): TagLift[] {
  return tags.map(tag => {
    let ww = 0, wl = 0, ow = 0, ol = 0, n = 0, awarded = 0;
    for (const e of entries) {
      const has = e.tag_ids.includes(tag.id);
      const c = outcomeClass(e.outcome);
      if (has) {
        n++;
        if (c === 'won') { ww++; awarded += convert(e.awarded_amount, e.currency, fx) ?? 0; }
        else if (c === 'lost') wl++;
      } else if (c === 'won') ow++;
      else if (c === 'lost') ol++;
    }
    const wd = ww + wl, od = ow + ol;
    const withRate = wd ? ww / wd : null;
    const withoutRate = od ? ow / od : null;
    return {
      tag, n,
      withWon: ww, withDecided: wd, withRate,
      withoutWon: ow, withoutDecided: od, withoutRate,
      delta: withRate != null && withoutRate != null ? withRate - withoutRate : null,
      p: wd && od ? fisherExact(ww, wl, ow, ol) : null,
      awarded,
    };
  }).filter(l => l.n > 0);
}

/** How often each pair of tags appears on the same grant. */
export function tagPairs(entries: InsightEntry[], tags: InsightTag[]): { a: InsightTag; b: InsightTag; n: number; won: number; decided: number }[] {
  const byId = new Map(tags.map(t => [t.id, t]));
  const counts = new Map<string, { n: number; won: number; decided: number }>();
  for (const e of entries) {
    const ids = [...new Set(e.tag_ids.filter(id => byId.has(id)))].sort();
    const c = outcomeClass(e.outcome);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}|${ids[j]}`;
        const cur = counts.get(k) ?? { n: 0, won: 0, decided: 0 };
        cur.n++;
        if (c === 'won') { cur.won++; cur.decided++; } else if (c === 'lost') cur.decided++;
        counts.set(k, cur);
      }
    }
  }
  return [...counts.entries()]
    .map(([k, v]) => { const [a, b] = k.split('|'); return { a: byId.get(a)!, b: byId.get(b)!, ...v }; })
    .sort((x, y) => y.n - x.n);
}

// ── Trend ────────────────────────────────────────────────────────────────────

export interface YearRow {
  year: number;
  label: string;
  n: number;
  counts: Record<StackKey, number>;
  requestedBy: Record<StackKey, number>;
  awarded: number;
  requested: number;
  won: number;
  decided: number;
  winRate: number | null;
  ci: [number, number] | null;
}

export function yearTrend(entries: InsightEntry[], fx: FxSettings): YearRow[] {
  const rows = new Map<number, YearRow>();
  const zero = () => Object.fromEntries(OUTCOME_STACK.map(s => [s.key, 0])) as Record<StackKey, number>;
  for (const e of entries) {
    const y = yearOf(e);
    if (y == null) continue;
    if (!rows.has(y)) {
      rows.set(y, { year: y, label: String(y), n: 0, counts: zero(), requestedBy: zero(), awarded: 0, requested: 0, won: 0, decided: 0, winRate: null, ci: null });
    }
    const r = rows.get(y)!;
    const sk = stackKey(e.outcome);
    const cls = outcomeClass(e.outcome);
    r.n++;
    r.counts[sk]++;
    const req = isSubmitted(e) ? convert(e.requested_amount, e.currency, fx) : null;
    if (req != null) { r.requested += req; r.requestedBy[sk] += req; }
    if (cls === 'won') { r.won++; r.decided++; r.awarded += convert(e.awarded_amount, e.currency, fx) ?? 0; }
    else if (cls === 'lost') r.decided++;
  }
  const out = [...rows.values()].sort((a, b) => a.year - b.year);
  // Fill gaps so the time axis is continuous.
  const filled: YearRow[] = [];
  for (let i = 0; i < out.length; i++) {
    filled.push(out[i]);
    const next = out[i + 1];
    if (next) {
      for (let y = out[i].year + 1; y < next.year; y++) {
        filled.push({ year: y, label: String(y), n: 0, counts: zero(), requestedBy: zero(), awarded: 0, requested: 0, won: 0, decided: 0, winRate: null, ci: null });
      }
    }
  }
  for (const r of filled) {
    r.winRate = r.decided ? r.won / r.decided : null;
    r.ci = wilson(r.won, r.decided);
  }
  return filled;
}

// ── Findings ─────────────────────────────────────────────────────────────────

export interface Finding {
  tone: 'up' | 'down' | 'neutral' | 'gap';
  text: string;
  gap?: GapKey;
  dimension?: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function findings(entries: InsightEntry[], tags: InsightTag[], fx: FxSettings, fmtMoney: (v: number) => string): Finding[] {
  const out: Finding[] = [];
  const m = computeMetrics(entries, fx);
  if (!m.n) return out;

  if (m.decided) {
    out.push({
      tone: 'neutral',
      text: `${m.won} of ${m.decided} decided proposals were funded (${pct(m.winRate!)}; 95% range ${pct(m.ci![0])}–${pct(m.ci![1])}).`,
    });
  } else {
    out.push({ tone: 'neutral', text: 'None of the selected grants has a decision yet, so there is no win rate.' });
  }

  // Tags that move the win rate, strongest evidence first.
  const lifts = tagLift(entries, tags, fx)
    .filter(l => l.delta != null && l.withDecided >= 3 && l.withoutDecided >= 3 && (l.p ?? 1) < 0.2)
    .sort((a, b) => (a.p ?? 1) - (b.p ?? 1));
  for (const l of lifts.slice(0, 3)) {
    const up = l.delta! > 0;
    const strength = (l.p ?? 1) < 0.05 ? '' : ' (suggestive — small sample)';
    out.push({
      tone: up ? 'up' : 'down',
      text: `Grants tagged “${l.tag.name}” won ${pct(l.withRate!)} of the time vs ${pct(l.withoutRate!)} without it — ${up ? '+' : '−'}${Math.abs(Math.round(l.delta! * 100))} points, p = ${l.p!.toFixed(2)}${strength}.`,
      dimension: l.tag.group ? `group:${l.tag.group}` : 'tags',
    });
  }

  // Funders.
  const funders = breakdown(entries, 'funder', tags, fx).filter(s => !s.muted);
  const topAward = [...funders].filter(s => s.metrics.awarded > 0).sort((a, b) => b.metrics.awarded - a.metrics.awarded)[0];
  if (topAward && funders.length > 1) {
    out.push({
      tone: 'up',
      text: `${topAward.label} is the largest funder in this selection: ${fmtMoney(topAward.metrics.awarded)} awarded across ${topAward.metrics.won} grant${topAward.metrics.won === 1 ? '' : 's'}.`,
      dimension: 'funder',
    });
  }
  const bestRate = funders.filter(s => s.metrics.decided >= 3).sort((a, b) => (b.metrics.winRate ?? 0) - (a.metrics.winRate ?? 0))[0];
  if (bestRate && bestRate !== topAward && (bestRate.metrics.winRate ?? 0) > (m.winRate ?? 0)) {
    out.push({
      tone: 'up',
      text: `Best hit rate with ${bestRate.label}: ${bestRate.metrics.won} of ${bestRate.metrics.decided} funded (${pct(bestRate.metrics.winRate!)}).`,
      dimension: 'funder',
    });
  }

  // Request size.
  const sizes = breakdown(entries, 'size', tags, fx).filter(s => !s.muted && s.metrics.decided >= 3);
  if (sizes.length >= 2) {
    const best = [...sizes].sort((a, b) => (b.metrics.winRate ?? 0) - (a.metrics.winRate ?? 0))[0];
    const worst = [...sizes].sort((a, b) => (a.metrics.winRate ?? 0) - (b.metrics.winRate ?? 0))[0];
    if (best !== worst && (best.metrics.winRate! - worst.metrics.winRate!) >= 0.15) {
      out.push({
        tone: 'neutral',
        text: `Requests of ${best.label} (${fx.base}) win most often (${pct(best.metrics.winRate!)}); ${worst.label} least (${pct(worst.metrics.winRate!)}).`,
        dimension: 'size',
      });
    }
  }

  // Trend: recent two years vs everything before.
  const trend = yearTrend(entries, fx).filter(r => r.decided > 0);
  if (trend.length >= 3) {
    const recent = trend.slice(-2);
    const earlier = trend.slice(0, -2);
    const rw = sum(recent.map(r => r.won)), rd = sum(recent.map(r => r.decided));
    const ew = sum(earlier.map(r => r.won)), ed = sum(earlier.map(r => r.decided));
    if (rd >= 3 && ed >= 3) {
      const d = rw / rd - ew / ed;
      if (Math.abs(d) >= 0.1) {
        out.push({
          tone: d > 0 ? 'up' : 'down',
          text: `Win rate ${d > 0 ? 'rose' : 'fell'} to ${pct(rw / rd)} in ${recent[0].year}–${recent[recent.length - 1].year}, from ${pct(ew / ed)} before.`,
          dimension: 'year',
        });
      }
    }
  }

  if (m.medianDays != null && m.daysCount >= 2) {
    const months = m.medianDays / 30.44;
    out.push({
      tone: 'neutral',
      text: `Funders took a median of ${months >= 2 ? `${months.toFixed(1)} months` : `${m.medianDays} days`} from submission to decision (${m.daysCount} grants with both dates).`,
    });
  }

  if (m.pipeline > 0) {
    out.push({ tone: 'neutral', text: `${fmtMoney(m.pipeline)} is still awaiting decisions across ${m.open} pending proposal${m.open === 1 ? '' : 's'}.` });
  }

  // Gaps that change the numbers.
  const gaps = gapCounts(entries);
  if (gaps.awarded) {
    out.push({ tone: 'gap', gap: 'awarded', text: `${gaps.awarded} funded grant${gaps.awarded === 1 ? ' has' : 's have'} no award amount, so awarded totals are understated.` });
  }
  if (gaps.requested) {
    out.push({ tone: 'gap', gap: 'requested', text: `${gaps.requested} grant${gaps.requested === 1 ? ' is' : 's are'} missing a requested amount and left out of money totals.` });
  }
  if (gaps.outcome) {
    out.push({ tone: 'gap', gap: 'outcome', text: `${gaps.outcome} grant${gaps.outcome === 1 ? ' has' : 's have'} no outcome and can't count toward the win rate.` });
  }
  if (m.unconverted) {
    out.push({ tone: 'gap', text: `${m.unconverted} amount${m.unconverted === 1 ? '' : 's'} in ${m.unconvertedCurrencies.join(', ')} have no exchange rate and are left out — add a rate under Currency.` });
  }
  return out;
}

// ── Amount parsing & formatting ──────────────────────────────────────────────

/** Parse "1.2M", "250k", "1,200,000", "€ 80 000". '' → null; garbage → NaN. */
export function parseAmount(raw: string): number | null {
  const compact = raw.trim().toLowerCase().replace(/[\s,_]/g, '');
  if (!compact) return null;
  // Allow one leading currency symbol or 3-letter code ("$", "€", "usd").
  const t = compact.replace(/^(?:[$€£¥₹]|[a-z]{3}(?=[\d.-]))/, '');
  const m = t.match(/^(-?\d*\.?\d+)(k|m|mn|bn|b)?$/);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9 }[m[2] as 'k' | 'm' | 'mn' | 'b' | 'bn'] ?? 1;
  return Number(m[1]) * mult;
}

export function formatMoney(v: number | null | undefined, currency: string, compact = true): string {
  if (v == null || !Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? (Math.abs(v) >= 1e6 ? 2 : 1) : 0,
    }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString()}`;
  }
}

export function formatPct(x: number | null | undefined, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatP(p: number | null | undefined): string {
  if (p == null) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(p < 0.01 ? 3 : 2);
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(c => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
