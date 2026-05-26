'use client';

interface ContextChipsProps {
  chips: string[];
}

export default function ContextChips({ chips }: ContextChipsProps) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
      <span className="text-[10px] text-gray-400 mr-1">Using:</span>
      {chips.map((chip) => (
        <span
          key={chip}
          className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
