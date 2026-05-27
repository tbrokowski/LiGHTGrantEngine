'use client';

import { useState } from 'react';
import { ChevronDown, Trash2, Plus, GripVertical } from 'lucide-react';
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

const PRIORITIES = ['high', 'medium', 'low'] as const;

export default function SkeletonEditor({ sections, onChange }: SkeletonEditorProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [expandedIntroArc, setExpandedIntroArc] = useState<number | null>(null);

  const updateSection = (index: number, patch: Partial<SkeletonSection>) => {
    onChange(sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
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
      { name: 'New Section', type: 'other', requirements: '', word_limit: null, priority: 'medium', order: sections.length },
    ]);
  };

  return (
    <div className="divide-y divide-gray-100">
      {sections.map((sec, i) => {
        const isExpanded = expandedIdx === i;
        const introSection = isIntroSection(sec);

        return (
          <div key={i} className="relative group py-3 pl-2 pr-3">
            {/* Grip — hover only */}
            <GripVertical className="absolute left-0 top-3.5 w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab select-none" />

            <div className="flex items-start gap-3 pl-4">
              {/* Number */}
              <span className="text-xs text-gray-400 mt-0.5 w-4 shrink-0 select-none">{i + 1}.</span>

              <div className="flex-1 min-w-0">
                {/* Row: name + word count + controls */}
                <div className="flex items-center gap-2">
                  <input
                    value={sec.name}
                    onChange={(e) => updateSection(i, { name: e.target.value })}
                    className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-0 border-b border-transparent focus:border-gray-300 focus:outline-none py-0 px-0 min-w-0"
                    placeholder="Section title"
                  />
                  {sec.word_limit ? (
                    <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                      ~{sec.word_limit.toLocaleString()} words
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedIdx(isExpanded ? null : i);
                      if (!isExpanded) setExpandedIntroArc(null);
                    }}
                    className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(i)}
                    className="shrink-0 text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove section"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Requirements preview (collapsed) */}
                {sec.requirements && !isExpanded && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{sec.requirements}</p>
                )}

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="mt-3 space-y-4">
                    {/* Requirements */}
                    <div>
                      <label className="text-xs font-semibold text-gray-500">Requirements</label>
                      <textarea
                        value={sec.requirements}
                        onChange={(e) => updateSection(i, { requirements: e.target.value })}
                        rows={3}
                        className="mt-1 w-full text-xs border border-gray-200 rounded px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                        placeholder="What this section must cover…"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                      {/* Word limit */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-gray-500">Word limit</label>
                        <input
                          type="number"
                          value={sec.word_limit ?? ''}
                          onChange={(e) =>
                            updateSection(i, { word_limit: e.target.value ? parseInt(e.target.value) : null })
                          }
                          className="w-20 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
                          placeholder="—"
                        />
                      </div>

                      {/* Section type */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-gray-500">Type</label>
                        <input
                          value={sec.type}
                          onChange={(e) => updateSection(i, { type: e.target.value })}
                          className="w-32 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
                          placeholder="introduction"
                        />
                      </div>

                      {/* Priority */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-gray-500">Priority</label>
                        <div className="flex gap-2 text-xs">
                          {PRIORITIES.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => updateSection(i, { priority: p })}
                              className={`capitalize transition-colors ${
                                sec.priority === p
                                  ? 'text-indigo-600 font-semibold'
                                  : 'text-gray-400 hover:text-gray-600'
                              }`}
                            >
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Move controls */}
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <button
                        type="button"
                        onClick={() => moveSection(i, -1)}
                        disabled={i === 0}
                        className="hover:text-gray-600 disabled:opacity-30 transition-colors"
                      >
                        ↑ Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(i, 1)}
                        disabled={i === sections.length - 1}
                        className="hover:text-gray-600 disabled:opacity-30 transition-colors"
                      >
                        ↓ Move down
                      </button>
                    </div>

                    {/* Intro arc (intro sections only) */}
                    {introSection && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setExpandedIntroArc(expandedIntroArc === i ? null : i)}
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          {expandedIntroArc === i ? 'Hide' : 'Edit'} intro arc
                        </button>
                        {expandedIntroArc === i && (
                          <div className="mt-2">
                            <IntroArcEditor
                              introArc={sec.intro_arc || DEFAULT_INTRO_ARC}
                              onChange={(arc) => updateSection(i, { intro_arc: arc })}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Add section */}
      <div className="py-3 pl-10">
        <button
          type="button"
          onClick={addSection}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add section
        </button>
      </div>
    </div>
  );
}
