'use client';
import { useState, KeyboardEvent } from 'react';

interface InterestBuilderProps {
  label: string;
  placeholder: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}

export default function InterestBuilder({
  label,
  placeholder,
  value,
  onChange,
  suggestions = [],
}: InterestBuilderProps) {
  const [input, setInput] = useState('');

  function addTag(tag: string) {
    const clean = tag.trim().toLowerCase();
    if (!clean || value.includes(clean)) return;
    onChange([...value, clean]);
    setInput('');
  }

  function removeTag(tag: string) {
    onChange(value.filter(t => t !== tag));
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="border border-gray-200 rounded-xl p-2 min-h-[80px] flex flex-wrap gap-1.5 focus-within:ring-1 focus-within:ring-gray-300 bg-white">
        {value.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-gray-400 hover:text-gray-600 w-3 h-3 rounded-full flex items-center justify-center"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => { if (input.trim()) addTag(input); }}
          placeholder={value.length === 0 ? placeholder : 'Add more…'}
          className="flex-1 min-w-[120px] text-sm text-gray-900 placeholder-gray-300 outline-none bg-transparent py-0.5 px-1"
        />
      </div>
      <p className="text-xs text-gray-400 mt-1">Press Enter or comma to add. Backspace to remove.</p>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.filter(s => !value.includes(s.toLowerCase())).slice(0, 12).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
