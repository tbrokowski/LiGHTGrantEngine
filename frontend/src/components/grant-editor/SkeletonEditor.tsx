'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Trash2, Plus, GripVertical, Settings2 } from 'lucide-react';
import IntroArcEditor, { DEFAULT_INTRO_ARC } from './IntroArcEditor';

export interface SkeletonSection {
  name: string;
  type: string;
  content?: string;
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

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
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
      placeholder={placeholder}
      rows={minRows}
      className={className}
      style={{ resize: 'none', overflow: 'hidden' }}
    />
  );
}

export default function SkeletonEditor({ sections, onChange }: SkeletonEditorProps) {
  const [settingsOpenIdx, setSettingsOpenIdx] = useState<number | null>(null);
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
      { name: 'New Section', type: 'other', content: '', requirements: '', word_limit: null, priority: 'medium', order: sections.length },
    ]);
  };

  return (
    <div className="space-y-6">
      {sections.map((sec, i) => {
        const settingsOpen = settingsOpenIdx === i;
        const introSection = isIntroSection(sec);

        return (
          <div key={i} className="group relative">
            {/* Section heading row */}
            <div className="flex items-start gap-2 mb-2">
              <GripVertical className="mt-1 w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab select-none shrink-0" />
              <span className="text-xs text-gray-400 mt-1.5 w-5 shrink-0 select-none tabular-nums">{i + 1}.</span>
              <input
                value={sec.name}
                onChange={(e) => updateSection(i, { name: e.target.value })}
                className="flex-1 text-base font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent focus:border-indigo-300 focus:outline-none py-0.5 px-0"
                placeholder="Section title"
              />
              {sec.word_limit ? (
                <span className="text-xs text-gray-400 mt-1.5 shrink-0 tabular-nums whitespace-nowrap">
                  ~{sec.word_limit.toLocaleString()} words
                </span>
              ) : null}
              {/* Settings toggle */}
              <button
                type="button"
                onClick={() => {
                  setSettingsOpenIdx(settingsOpen ? null : i);
                  if (!settingsOpen) setExpandedIntroArc(null);
                }}
                title="Section settings"
                className={`mt-0.5 shrink-0 transition-colors ${settingsOpen ? 'text-indigo-500' : 'text-gray-300 hover:text-gray-500'}`}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
              {/* Delete */}
              <button
                type="button"
                onClick={() => removeSection(i)}
                className="mt-0.5 shrink-0 text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove section"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content — primary editable draft text */}
            <div className="pl-11">
              <AutoResizeTextarea
                value={sec.content ?? ''}
                onChange={(v) => updateSection(i, { content: v })}
                placeholder="Start drafting this section…"
                minRows={4}
                className="w-full text-sm text-gray-800 leading-relaxed bg-white border border-gray-200 rounded-lg px-3.5 py-3 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-gray-300"
              />
            </div>

            {/* Settings panel (collapsed by default) */}
            {settingsOpen && (
              <div className="pl-11 mt-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                {/* Requirements */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requirements (internal)</label>
                  <AutoResizeTextarea
                    value={sec.requirements}
                    onChange={(v) => updateSection(i, { requirements: v })}
                    minRows={2}
                    className="mt-1 w-full text-xs border border-gray-200 rounded px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                    placeholder="What this section must cover — used by the full-draft agent"
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
                      className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${expandedIntroArc === i ? '' : '-rotate-90'}`} />
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

            {/* Section divider */}
            {i < sections.length - 1 && (
              <div className="mt-6 border-t border-gray-100" />
            )}
          </div>
        );
      })}

      {/* Add section */}
      <div className="pl-11 pt-2">
        <button
          type="button"
          onClick={addSection}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-indigo-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add section
        </button>
      </div>
    </div>
  );
}
