'use client';

import { useRef, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';

interface SkeletonEditorProps {
  rawText: string;
  onChange: (text: string) => void;
  flaggedSections: string[];
  onFlaggedChange: (names: string[]) => void;
}

/** Parse section names from ## headings in the raw text. */
function parseSectionNames(rawText: string): string[] {
  return rawText
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function AutoResizeTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`## Section Title\n\nStart drafting this section…\n\n## Next Section\n\nContinue the narrative…`}
      className="w-full text-sm text-gray-800 leading-relaxed bg-white border border-gray-200 rounded-lg px-4 py-3.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-gray-300 font-mono"
      style={{ resize: 'none', overflow: 'hidden', minHeight: '320px' }}
      spellCheck
    />
  );
}

export default function SkeletonEditor({
  rawText,
  onChange,
  flaggedSections,
  onFlaggedChange,
}: SkeletonEditorProps) {
  const sectionNames = useMemo(() => parseSectionNames(rawText), [rawText]);
  const flaggedSet = new Set(flaggedSections);

  const toggleFlag = (name: string) => {
    const next = new Set(flaggedSet);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onFlaggedChange(Array.from(next));
  };

  return (
    <div className="space-y-4">
      {/* Single document editor */}
      <AutoResizeTextarea value={rawText} onChange={onChange} />

      {/* Section flag strip — only shown when headings are detected */}
      {sectionNames.length > 0 && (
        <div className="border border-gray-200 rounded-lg px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Sections — star to prioritise for draft generation
          </p>
          {sectionNames.map((name) => {
            const flagged = flaggedSet.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleFlag(name)}
                className={`flex items-center gap-2 w-full text-left text-sm rounded-md px-2 py-1 transition-colors ${
                  flagged
                    ? 'bg-amber-50 text-amber-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Star
                  className={`w-3 h-3 shrink-0 ${
                    flagged ? 'fill-amber-400 text-amber-400' : 'text-gray-300'
                  }`}
                />
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
