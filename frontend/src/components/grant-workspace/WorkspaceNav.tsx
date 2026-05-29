'use client';

export type WorkspaceTab =
  | 'overview'
  | 'tasks'
  | 'editor'
  | 'files'
  | 'budget'
  | 'finance'
  | 'team'
  | 'planning'
  | 'more';

const PROPOSAL_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files' },
  { id: 'budget', label: 'Budget' },
  { id: 'team', label: 'Team' },
  { id: 'planning', label: 'Planning' },
  { id: 'more', label: 'More' },
];

const ACTIVE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'budget', label: 'Budget' },
  { id: 'finance', label: 'Finance' },
  { id: 'files', label: 'Files' },
  { id: 'team', label: 'Team' },
];

interface WorkspaceNavProps {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  /** Compact inline variant — no bottom border, smaller text, pill buttons */
  compact?: boolean;
  /** Active/awarded grants use finance-focused tabs (no editor/planning). */
  mode?: 'proposal' | 'active';
}

export default function WorkspaceNav({
  activeTab,
  onChange,
  compact = false,
  mode = 'proposal',
}: WorkspaceNavProps) {
  const tabs = mode === 'active' ? ACTIVE_TABS : PROPOSAL_TABS;
  if (compact) {
    return (
      <div className="flex items-center gap-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`whitespace-nowrap px-3 py-2 text-xs font-medium rounded-none border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="flex">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`whitespace-nowrap px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
