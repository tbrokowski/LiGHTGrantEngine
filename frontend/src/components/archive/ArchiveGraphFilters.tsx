'use client';

export interface ArchiveGraphFilterState {
  funder: string;
  outcome: string;
  year: string;
  theme: string;
}

interface Props {
  filters: ArchiveGraphFilterState;
  onChange: (f: ArchiveGraphFilterState) => void;
  funders: string[];
  years: number[];
  themes: string[];
}

const OUTCOMES = [
  { value: '', label: 'All outcomes' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_funded', label: 'Partially funded' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'resubmitted', label: 'Resubmitted' },
  { value: 'not_submitted', label: 'Not submitted' },
];

const selectCls =
  'text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 text-gray-700 min-w-[120px]';

export default function ArchiveGraphFilters({ filters, onChange, funders, years, themes }: Props) {
  const set = (key: keyof ArchiveGraphFilterState, value: string) =>
    onChange({ ...filters, [key]: value });

  const hasFilter =
    filters.funder !== '' || filters.outcome !== '' || filters.year !== '' || filters.theme !== '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectCls}
        value={filters.funder}
        onChange={e => set('funder', e.target.value)}
        aria-label="Filter by funder"
      >
        <option value="">All funders</option>
        {funders.map(f => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filters.outcome}
        onChange={e => set('outcome', e.target.value)}
        aria-label="Filter by outcome"
      >
        {OUTCOMES.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filters.year}
        onChange={e => set('year', e.target.value)}
        aria-label="Filter by year"
      >
        <option value="">All years</option>
        {years.map(y => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>

      {themes.length > 0 && (
        <select
          className={selectCls}
          value={filters.theme}
          onChange={e => set('theme', e.target.value)}
          aria-label="Filter by theme"
        >
          <option value="">All themes</option>
          {themes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}

      {hasFilter && (
        <button
          onClick={() => onChange({ funder: '', outcome: '', year: '', theme: '' })}
          className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-1 rounded transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
