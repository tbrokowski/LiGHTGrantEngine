'use client';

export interface SavedView {
  id: string;
  label: string;
  filters: {
    status?: string;
    relationship_stage?: string;
    owner?: 'me';
    overdue?: boolean;
    daysInactive?: number;
  };
}

export const DEFAULT_VIEWS: SavedView[] = [
  { id: 'all', label: 'All Partners', filters: {} },
  { id: 'mine', label: 'My Partners', filters: { owner: 'me' } },
  { id: 'overdue', label: 'Overdue Follow-ups', filters: { overdue: true } },
  { id: 'active', label: 'Active Collaborators', filters: { relationship_stage: 'collaborating' } },
  { id: 'stale', label: 'Stale (90+ days)', filters: { daysInactive: 90 } },
];

interface SavedViewsTabsProps {
  activeView: string;
  onViewChange: (view: SavedView) => void;
  counts?: Record<string, number>;
}

export default function SavedViewsTabs({ activeView, onViewChange, counts = {} }: SavedViewsTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5">
      {DEFAULT_VIEWS.map(view => {
        const count = counts[view.id];
        const isActive = activeView === view.id;
        return (
          <button
            key={view.id}
            onClick={() => onViewChange(view)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all ${
              isActive
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            {view.label}
            {count != null && count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
