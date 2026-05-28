'use client';

export type WorkspaceTab =
  | 'overview'
  | 'tasks'
  | 'editor'
  | 'files'
  | 'budget'
  | 'team'
  | 'planning'
  | 'more';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files' },
  { id: 'budget', label: 'Budget' },
  { id: 'team', label: 'Team' },
  { id: 'planning', label: 'Planning' },
  { id: 'more', label: 'More' },
];

interface WorkspaceNavProps {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  /** Compact inline variant — no bottom border, smaller text, pill buttons */
  compact?: boolean;
}

export default function WorkspaceNav({ activeTab, onChange, compact = false }: WorkspaceNavProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-0.5">
        {TABS.map((tab) => (
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
        {TABS.map((tab) => (
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
