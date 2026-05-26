'use client';
import { THEME_OPTIONS, type OpportunityFilters as Filters } from './types';

interface OpportunityFiltersProps {
  filters: Filters;
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onClear: () => void;
  show: boolean;
}

export default function OpportunityFiltersBar({ filters, onChange, onClear, show }: OpportunityFiltersProps) {
  const hasFilters = filters.search || filters.priority || filters.theme ||
    filters.deadlineBefore || filters.deadlineAfter || filters.awardMin;

  if (!show) return null;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
        <select
          value={filters.priority}
          onChange={e => onChange('priority', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="">All</option>
          <option value="high_priority">High priority</option>
          <option value="worth_reviewing">Worth reviewing</option>
          <option value="watchlist">Watchlist</option>
          <option value="low_fit">Low fit</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Theme / Keyword</label>
        <select
          value={filters.theme}
          onChange={e => onChange('theme', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="">All themes</option>
          {THEME_OPTIONS.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Deadline from</label>
        <input
          type="date"
          value={filters.deadlineAfter}
          onChange={e => onChange('deadlineAfter', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Deadline to</label>
        <input
          type="date"
          value={filters.deadlineBefore}
          onChange={e => onChange('deadlineBefore', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Min award</label>
        <input
          type="text"
          placeholder="e.g. 50000"
          value={filters.awardMin}
          onChange={e => onChange('awardMin', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      {hasFilters && (
        <div className="col-span-full flex justify-end">
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-600">
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
