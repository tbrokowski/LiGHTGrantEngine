'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { SkeletonSection } from '../SkeletonEditor';

interface SkeletonPhaseProps {
  skeleton: { sections?: SkeletonSection[]; title_suggestion?: string; narrative_arc?: string; key_messages?: string[]; raw_text?: string };
  onSkeletonChange: (skeleton: Record<string, unknown>) => void;
  onGenerateDraft: () => void;
  generating: boolean;
  draftProgress?: { section: string; index: number; total: number } | null;
  onSelectionChange?: (text: string) => void;
}

function flattenSections(sections: SkeletonSection[]): string {
  return sections
    .map((s) => `## ${s.name}\n\n${s.content ?? ''}`)
    .join('\n\n');
}

export default function SkeletonPhase({
  skeleton,
  onSkeletonChange,
  onGenerateDraft,
  generating,
  draftProgress,
  onSelectionChange,
}: SkeletonPhaseProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(skeleton.title_suggestion || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-flatten sections → raw_text on first load if raw_text is missing
  useEffect(() => {
    if (!skeleton.raw_text && skeleton.sections && skeleton.sections.length > 0) {
      onSkeletonChange({ ...skeleton, raw_text: flattenSections(skeleton.sections) });
    }
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [skeleton.raw_text]);

  const rawText = (skeleton.raw_text as string) ?? '';

  const commitTitle = () => {
    setEditingTitle(false);
    onSkeletonChange({ ...skeleton, title_suggestion: titleDraft });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scrollable document body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-8 pt-8 pb-6 space-y-3">

          {/* Proposal title — editable, large */}
          {skeleton.title_suggestion !== undefined && (
            <div className="mb-1">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); }}
                  className="w-full text-xl font-bold text-gray-900 border-b border-indigo-300 focus:outline-none bg-transparent pb-1"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditingTitle(true); setTitleDraft(skeleton.title_suggestion || ''); }}
                  className="text-xl font-bold text-gray-900 text-left hover:text-indigo-700 transition-colors w-full"
                >
                  {skeleton.title_suggestion}
                </button>
              )}
              <p className="text-xs text-gray-400 mt-0.5">Click title to edit</p>
            </div>
          )}

          {/* Narrative arc */}
          {skeleton.narrative_arc && (
            <p className="text-sm italic text-gray-500 border-l-2 border-indigo-200 pl-3">
              {skeleton.narrative_arc}
            </p>
          )}

          {/* Key messages */}
          {skeleton.key_messages && skeleton.key_messages.length > 0 && (
            <p className="text-xs text-gray-400">
              {skeleton.key_messages.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5 text-gray-300">·</span>}
                  {m}
                </span>
              ))}
            </p>
          )}

          {/* Document divider */}
          <div className="border-t border-gray-200 pt-2" />

          {/* Raw text editor */}
          <textarea
            ref={textareaRef}
            value={rawText}
            onChange={(e) => onSkeletonChange({ ...skeleton, raw_text: e.target.value })}
            onSelect={(e) => {
              const t = e.currentTarget;
              const sel = t.value.substring(t.selectionStart, t.selectionEnd);
              onSelectionChange?.(sel);
            }}
            onBlur={() => onSelectionChange?.('')}
            placeholder="Your proposal skeleton will appear here. Edit freely…"
            className="w-full text-sm text-gray-800 leading-relaxed bg-white border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-gray-300"
            style={{ resize: 'none', overflow: 'hidden', minHeight: '24rem' }}
          />

          {/* Draft progress */}
          {draftProgress && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                Drafting {draftProgress.section}… ({draftProgress.index + 1}/{draftProgress.total})
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-400 transition-all duration-500"
                  style={{ width: `${((draftProgress.index + 1) / draftProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 border-t border-gray-200 px-6 py-3 flex items-center justify-between">
        <p className="text-sm text-gray-400">Edit the skeleton, then generate the full draft</p>
        <button
          onClick={onGenerateDraft}
          disabled={!rawText.trim() || generating}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate Full Draft
        </button>
      </div>
    </div>
  );
}
