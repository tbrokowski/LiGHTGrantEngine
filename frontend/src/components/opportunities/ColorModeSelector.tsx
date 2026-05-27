'use client';

export type ColorMode = 'community' | 'thematic' | 'fit_score' | 'deadline';

const MODES: { id: ColorMode; label: string; description: string }[] = [
  { id: 'community', label: 'Community', description: 'Leiden community assignment' },
  { id: 'thematic', label: 'Theme', description: 'Primary thematic area' },
  { id: 'fit_score', label: 'Fit Score', description: 'Low → high score gradient' },
  { id: 'deadline', label: 'Deadline', description: 'Urgency: green → amber → red' },
];

interface Props {
  value: ColorMode;
  onChange: (mode: ColorMode) => void;
}

export default function ColorModeSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-400 mr-1">Color by</span>
      {MODES.map(mode => (
        <button
          key={mode.id}
          onClick={() => onChange(mode.id)}
          title={mode.description}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            value === mode.id
              ? 'bg-gray-900 text-white'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
