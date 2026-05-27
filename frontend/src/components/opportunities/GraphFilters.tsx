'use client';

export interface GraphFilterState {
  funder: string;
  theme: string;
  deadlineDays: string;
}

interface GraphFiltersProps {
  filters: GraphFilterState;
  onChange: (filters: GraphFilterState) => void;
  funders: string[];
  themes: string[];
}

export default function GraphFilters({ filters, onChange, funders, themes }: GraphFiltersProps) {
  function set(key: keyof GraphFilterState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={filters.funder}
        onChange={e => set('funder', e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
      >
        <option value="">All funders</option>
        {funders.map(f => <option key={f} value={f}>{f}</option>)}
      </select>

      <select
        value={filters.theme}
        onChange={e => set('theme', e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
      >
        <option value="">All topics</option>
        {themes.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select
        value={filters.deadlineDays}
        onChange={e => set('deadlineDays', e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
      >
        <option value="">Any deadline</option>
        <option value="14">Next 14 days</option>
        <option value="30">Next 30 days</option>
        <option value="60">Next 60 days</option>
        <option value="90">Next 90 days</option>
      </select>

      {(filters.funder || filters.theme || filters.deadlineDays) && (
        <button
          type="button"
          onClick={() => onChange({ funder: '', theme: '', deadlineDays: '' })}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
