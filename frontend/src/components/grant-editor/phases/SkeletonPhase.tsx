'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import SkeletonEditor, { SkeletonSection } from '../SkeletonEditor';

interface SkeletonPhaseProps {
  skeleton: { sections?: SkeletonSection[]; title_suggestion?: string; narrative_arc?: string; key_messages?: string[] };
  onSkeletonChange: (skeleton: Record<string, unknown>) => void;
  onGenerateDraft: () => void;
  generating: boolean;
  draftProgress?: { section: string; index: number; total: number } | null;
}

export default function SkeletonPhase({
  skeleton,
  onSkeletonChange,
  onGenerateDraft,
  generating,
  draftProgress,
}: SkeletonPhaseProps) {
  const sections = skeleton.sections || [];
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(skeleton.title_suggestion || '');

  const updateSections = (updated: SkeletonSection[]) => {
    onSkeletonChange({ ...skeleton, sections: updated });
  };

  const commitTitle = () => {
    setEditingTitle(false);
    onSkeletonChange({ ...skeleton, title_suggestion: titleDraft });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-6 pt-6 pb-4 space-y-4">
          {/* Title suggestion — editable plain text */}
          {skeleton.title_suggestion !== undefined && (
            <div>
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); }}
                  className="w-full text-sm font-medium text-gray-900 border-b border-gray-300 focus:outline-none bg-transparent pb-0.5"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditingTitle(true); setTitleDraft(skeleton.title_suggestion || ''); }}
                  className="text-sm font-medium text-gray-900 text-left hover:text-indigo-700 transition-colors w-full"
                >
                  &ldquo;{skeleton.title_suggestion}&rdquo;
                </button>
              )}
              <p className="text-xs text-gray-400 mt-0.5">Suggested title — click to edit</p>
            </div>
          )}

          {/* Narrative arc */}
          {skeleton.narrative_arc && (
            <p className="text-sm italic text-gray-500">{skeleton.narrative_arc}</p>
          )}

          {/* Key messages — dot-separated inline */}
          {skeleton.key_messages && skeleton.key_messages.length > 0 && (
            <p className="text-sm text-gray-400">
              {skeleton.key_messages.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5">·</span>}
                  {m}
                </span>
              ))}
            </p>
          )}

          {/* Divider */}
          <div className="border-t border-gray-100" />

          {/* Outline header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outline</span>
            <span className="text-xs text-gray-400">{sections.length} sections</span>
          </div>

          {/* Section list */}
          <SkeletonEditor sections={sections} onChange={updateSections} />

          {/* Draft progress */}
          {draftProgress && (
            <div className="space-y-2">
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
          <p className="text-sm text-gray-400">Sections drafted one at a time with archive style matching</p>
        <button
          onClick={onGenerateDraft}
          disabled={sections.length === 0 || generating}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate Full Draft
        </button>
      </div>
    </div>
  );
}
