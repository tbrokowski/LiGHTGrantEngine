'use client';

interface ViewToggleProps {
  view: 'list' | 'graph';
  onChange: (view: 'list' | 'graph') => void;
}

export default function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
      <button
        type="button"
        onClick={() => onChange('list')}
        title="List view"
        className={`w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${
          view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('graph')}
        title="Graph view"
        className={`w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${
          view === 'graph' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="9" cy="9" r="2.5" /><circle cx="15" cy="15" r="2.5" /><circle cx="15" cy="6" r="2" />
          <line x1="9" y1="9" x2="15" y2="6" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="6" x2="15" y2="15" />
        </svg>
      </button>
    </div>
  );
}
