'use client';

import { Loader2, Sparkles, FileText } from 'lucide-react';
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

  const updateSections = (updated: SkeletonSection[]) => {
    onSkeletonChange({ ...skeleton, sections: updated });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full space-y-5">
      {skeleton.title_suggestion && (
        <div className="text-sm bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">
          <span className="font-medium text-indigo-800">Suggested title: </span>
          <span className="text-indigo-700">{skeleton.title_suggestion}</span>
        </div>
      )}

      {skeleton.narrative_arc && (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          <span className="font-medium text-gray-700">Narrative arc: </span>
          {skeleton.narrative_arc}
        </div>
      )}

      {skeleton.key_messages && skeleton.key_messages.length > 0 && (
        <div className="text-xs">
          <div className="font-medium text-gray-700 mb-1">Key messages</div>
          <ul className="list-disc list-inside text-gray-600 space-y-0.5">
            {skeleton.key_messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">Proposal Outline</h2>
          <span className="text-xs text-gray-400">{sections.length} sections</span>
        </div>
        <SkeletonEditor sections={sections} onChange={updateSections} />
      </div>

      {draftProgress && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            Drafting: {draftProgress.section} ({draftProgress.index + 1}/{draftProgress.total})
          </div>
          <div className="mt-2 h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${((draftProgress.index + 1) / draftProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <FileText className="w-3.5 h-3.5" />
          Sections will be drafted one at a time with archive style matching
        </div>
        <button
          onClick={onGenerateDraft}
          disabled={sections.length === 0 || generating}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate Full Draft
        </button>
      </div>
    </div>
  );
}
