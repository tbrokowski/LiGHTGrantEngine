'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, Plus, GripVertical } from 'lucide-react';
import IntroArcEditor, { DEFAULT_INTRO_ARC } from './IntroArcEditor';

export interface SkeletonSection {
  name: string;
  type: string;
  requirements: string;
  word_limit: number | null;
  priority: string;
  suggested_lead?: string;
  order?: number;
  intro_arc?: Array<{ beat: string; label: string; guidance: string }>;
}

interface SkeletonEditorProps {
  sections: SkeletonSection[];
  onChange: (sections: SkeletonSection[]) => void;
}

const INTRO_TYPES = new Set(['introduction', 'background', 'problem_statement', 'executive_summary', 'justification']);

function isIntroSection(sec: SkeletonSection): boolean {
  const name = sec.name.toLowerCase();
  const type = sec.type.toLowerCase();
  return INTRO_TYPES.has(type) || ['intro', 'background', 'problem', 'rationale'].some((k) => name.includes(k));
}

export default function SkeletonEditor({ sections, onChange }: SkeletonEditorProps) {
  const [expandedIntro, setExpandedIntro] = useState<number | null>(null);

  const updateSection = (index: number, patch: Partial<SkeletonSection>) => {
    const updated = sections.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(updated);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const updated = [...sections];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    onChange(updated.map((s, i) => ({ ...s, order: i })));
  };

  const removeSection = (index: number) => {
    onChange(sections.filter((_, i) => i !== index));
  };

  const addSection = () => {
    onChange([
      ...sections,
      {
        name: 'New Section',
        type: 'other',
        requirements: '',
        word_limit: null,
        priority: 'medium',
        order: sections.length,
      },
    ]);
  };

  return (
    <div className="space-y-2">
      {sections.map((sec, i) => (
        <div key={i} className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="flex items-start gap-2">
            <GripVertical className="w-4 h-4 text-gray-300 mt-1 shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex gap-2">
                <input
                  value={sec.name}
                  onChange={(e) => updateSection(i, { name: e.target.value })}
                  className="flex-1 text-sm font-medium border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="Section title"
                />
                <select
                  value={sec.priority}
                  onChange={(e) => updateSection(i, { priority: e.target.value })}
                  className="text-xs border border-gray-200 rounded px-2 py-1"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  value={sec.type}
                  onChange={(e) => updateSection(i, { type: e.target.value })}
                  className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
                  placeholder="Section type"
                />
                <input
                  type="number"
                  value={sec.word_limit ?? ''}
                  onChange={(e) => updateSection(i, { word_limit: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-24 text-xs border border-gray-200 rounded px-2 py-1"
                  placeholder="Words"
                />
              </div>
              <textarea
                value={sec.requirements}
                onChange={(e) => updateSection(i, { requirements: e.target.value })}
                rows={2}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                placeholder="Section requirements from the call..."
              />
              {isIntroSection(sec) && (
                <div>
                  <button
                    type="button"
                    onClick={() => setExpandedIntro(expandedIntro === i ? null : i)}
                    className="text-[10px] text-indigo-600 hover:underline"
                  >
                    {expandedIntro === i ? 'Hide' : 'Edit'} intro arc template
                  </button>
                  {expandedIntro === i && (
                    <IntroArcEditor
                      introArc={sec.intro_arc || DEFAULT_INTRO_ARC}
                      onChange={(arc) => updateSection(i, { intro_arc: arc })}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-0.5 shrink-0">
              <button type="button" onClick={() => moveSection(i, -1)} className="p-0.5 text-gray-400 hover:text-gray-600" title="Move up">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => moveSection(i, 1)} className="p-0.5 text-gray-400 hover:text-gray-600" title="Move down">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => removeSection(i)} className="p-0.5 text-red-400 hover:text-red-600" title="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addSection}
        className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1.5"
      >
        <Plus className="w-3.5 h-3.5" />
        Add section
      </button>
    </div>
  );
}
