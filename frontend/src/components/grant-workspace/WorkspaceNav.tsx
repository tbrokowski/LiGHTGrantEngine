'use client';

export type WorkspaceTab =
  | 'overview'
  | 'tasks'
  | 'editor'
  | 'files'
  | 'budget'
  | 'team'
  | 'more';

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files' },
  { id: 'budget', label: 'Budget' },
  { id: 'team', label: 'Team' },
  { id: 'more', label: 'More' },
];

interface WorkspaceNavProps {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}

export default function WorkspaceNav({ activeTab, onChange }: WorkspaceNavProps) {
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
