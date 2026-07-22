'use client';
import FunderDropdown from './FunderDropdown';
import OpportunityTypeBadge from './OpportunityTypeBadge';
import { type OpportunityFilters as Filters, type FilterOptions } from './types';

interface Props {
  filters: Filters;
  filterOptions: FilterOptions | null;
  priorityFunderGroups?: { name: string; funders: string[] }[];
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onClear: () => void;
}

const OPP_TYPES = [
  'grant', 'fellowship', 'scholarship', 'residency',
  'open_call', 'prize', 'bursary', 'commission',
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 my-3" />;
}

export default function OpportunityFiltersSidebar({ filters, filterOptions, priorityFunderGroups, onChange, onClear }: Props) {
  const hasFilters = !!(
    filters.search || filters.priority || filters.theme || filters.opportunityType ||
    filters.geography || filters.funder || filters.funderCategory || filters.priorityFunderGroup || filters.sourceId ||
    filters.funderOrgId ||
    filters.deadlineBefore || filters.deadlineAfter || filters.awardMin || filters.awardMax ||
    filters.hasDeadline || filters.sortBy !== 'relevance'
  );

  const activeCount = [
    filters.search, filters.priority, filters.theme, filters.opportunityType,
    filters.geography, filters.funder, filters.funderCategory, filters.priorityFunderGroup, filters.sourceId,
    filters.funderOrgId,
    filters.deadlineBefore, filters.deadlineAfter, filters.awardMin, filters.awardMax,
    filters.hasDeadline || undefined,
  ].filter(Boolean).length;

  return (
    <aside className="w-64 shrink-0 border-r border-gray-100 bg-white min-h-screen sticky top-0 overflow-y-auto px-4 py-6 flex flex-col gap-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-700">
          Filters
          {activeCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-900 text-white text-[10px] font-bold">
              {activeCount}
            </span>
          )}
        </span>
        {hasFilters && (
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Clear all
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-3">
        <SectionLabel>Search</SectionLabel>
        <input
          type="text"
          placeholder="Title, funder, keyword…"
          value={filters.search}
          onChange={e => onChange('search', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder:text-gray-300"
        />
      </div>

      <Divider />

      {/* Sort */}
      <div className="mb-3">
        <SectionLabel>Sort by</SectionLabel>
        <select
          value={filters.sortBy}
          onChange={e => onChange('sortBy', e.target.value as Filters['sortBy'])}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="relevance">Relevance (profile match)</option>
          <option value="deadline">Deadline (soonest)</option>
          <option value="award">Award (largest)</option>
        </select>
      </div>

      <Divider />

      {/* Opportunity Type */}
      <div className="mb-3">
        <SectionLabel>Type</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {OPP_TYPES.map(t => (
            <button
              key={t}
              onClick={() => onChange('opportunityType', filters.opportunityType === t ? '' : t)}
              className={`transition-all ${
                filters.opportunityType === t
                  ? 'ring-2 ring-gray-900 ring-offset-1 rounded-md'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <OpportunityTypeBadge type={t} size="xs" />
            </button>
          ))}
        </div>
      </div>

      <Divider />

      {/* Funder Organization */}
      <div className="mb-3">
        <SectionLabel>Funder</SectionLabel>
        <FunderDropdown
          value={filters.funder}
          onChange={v => onChange('funder', v)}
          options={filterOptions?.funders ?? []}
        />
      </div>

      {/* Source Category */}
      {filterOptions?.source_categories && filterOptions.source_categories.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Funder category</SectionLabel>
          <select
            value={filters.funderCategory}
            onChange={e => onChange('funderCategory', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="">All categories</option>
            {filterOptions.source_categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {/* Priority funder group */}
      {priorityFunderGroups && priorityFunderGroups.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Priority funder group</SectionLabel>
          <select
            value={filters.priorityFunderGroup}
            onChange={e => onChange('priorityFunderGroup', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="">All funders</option>
            {priorityFunderGroups.map(g => (
              <option key={g.name} value={g.name}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Funder Org — the funding body (e.g. Fulbright), distinct from portal below */}
      {filterOptions?.funder_orgs && filterOptions.funder_orgs.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Funder org</SectionLabel>
          <select
            value={filters.funderOrgId}
            onChange={e => onChange('funderOrgId', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="">All funder orgs</option>
            {filterOptions.funder_orgs.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Funder Portal — the scraper source this opportunity was discovered through */}
      {filterOptions?.sources && filterOptions.sources.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Funder portal</SectionLabel>
          <select
            value={filters.sourceId}
            onChange={e => onChange('sourceId', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="">All portals</option>
            {filterOptions.sources.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <Divider />

      {/* Fit score */}
      <div className="mb-3">
        <SectionLabel>Fit level</SectionLabel>
        <select
          value={filters.priority}
          onChange={e => onChange('priority', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="">All</option>
          <option value="high">High fit</option>
          <option value="medium">Medium fit</option>
          <option value="low">Low fit</option>
        </select>
      </div>

      <Divider />

      {/* Geography */}
      {filterOptions?.geographies && filterOptions.geographies.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Geography</SectionLabel>
          <select
            value={filters.geography}
            onChange={e => onChange('geography', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="">All geographies</option>
            {filterOptions.geographies.slice(0, 100).map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      )}

      {/* Thematic Area */}
      <div className="mb-3">
        <SectionLabel>Theme / area</SectionLabel>
        <select
          value={filters.theme}
          onChange={e => onChange('theme', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="">All themes</option>
          {(filterOptions?.thematic_areas ?? []).slice(0, 150).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <Divider />

      {/* Award range */}
      <div className="mb-3">
        <SectionLabel>Award range</SectionLabel>
        <div className="flex gap-1.5">
          <input
            type="text"
            placeholder="Min"
            value={filters.awardMin}
            onChange={e => onChange('awardMin', e.target.value)}
            className="w-1/2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <input
            type="text"
            placeholder="Max"
            value={filters.awardMax}
            onChange={e => onChange('awardMax', e.target.value)}
            className="w-1/2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
      </div>

      <Divider />

      {/* Deadline range */}
      <div className="mb-3">
        <SectionLabel>Deadline</SectionLabel>
        <div className="space-y-1.5">
          <input
            type="date"
            value={filters.deadlineAfter}
            onChange={e => onChange('deadlineAfter', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <input
            type="date"
            value={filters.deadlineBefore}
            onChange={e => onChange('deadlineBefore', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.hasDeadline}
            onChange={e => onChange('hasDeadline', e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
          />
          <span className="text-xs text-gray-500">Listed deadline only</span>
        </label>
      </div>
    </aside>
  );
}
