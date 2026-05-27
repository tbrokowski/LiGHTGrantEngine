'use client';

export const GRANT_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#64748b', // slate
];

interface GrantColorPickerProps {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  label?: string;
}

export default function GrantColorPicker({ value, onChange, label = 'Color' }: GrantColorPickerProps) {
  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* None swatch */}
        <button
          type="button"
          title="No color"
          onClick={() => onChange(null)}
          className={`w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center ${
            value
              ? 'border-gray-200 hover:border-gray-300'
              : 'border-gray-400 ring-2 ring-offset-1 ring-gray-300'
          }`}
          style={{ background: 'repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 2px, #fff 2px, #fff 6px)' }}
        >
          {value ? null : (
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>

        {GRANT_COLORS.map(color => (
          <button
            key={color}
            type="button"
            title={color}
            onClick={() => onChange(color)}
            className={`w-6 h-6 rounded-full border-2 transition-all ${
              value === color
                ? 'border-white ring-2 ring-offset-1'
                : 'border-transparent hover:scale-110'
            }`}
            style={{
              backgroundColor: color,
              ...(value === color ? { ringColor: color } : {}),
              boxShadow: value === color ? `0 0 0 2px ${color}` : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}
