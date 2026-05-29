'use client';

import { useState } from 'react';
import { Loader2, Sparkles, Star, BookOpen, RefreshCw, ImageIcon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import SkeletonEditor from '../SkeletonEditor';
import MetaAgentPanel from '../MetaAgentPanel';
import AIThinkingLog from '../AIThinkingLog';
import type { AIThinkingStep } from '../AIThinkingLog';
import type { MetaAgentEvent, AgentQuestion } from '../MetaAgentPanel';
import type { CoherenceResult } from '../WorkspaceContext';

export interface DraftProgress {
  phase: 'planning' | 'researching' | 'drafting' | 'assembling' | 'complete';
  section?: string;
  index?: number;
  total?: number;
  researchTotal?: number;
  researchDone?: number;
}

export interface SkeletonProgress {
  phase: 'starting' | 'style_profile' | 'archive_retrieval' | 'call_strategy' | 'idea_alignment' | 'synthesis' | 'complete';
}

interface SkeletonPhaseProps {
  skeleton: {
    raw_text?: string;
    flagged_sections?: string[];
    title_suggestion?: string;
    narrative_arc?: string;
    key_messages?: string[];
  };
  onSkeletonChange: (skeleton: Record<string, unknown>) => void;
  onGenerateDraft: (flaggedSections: string[]) => void;
  generating: boolean;
  draftProgress?: DraftProgress | null;
  onSelectionChange?: (text: string) => void;
  metaAgentEvents?: MetaAgentEvent[];
  agentQuestions?: AgentQuestion[];
  coherenceResult?: CoherenceResult | null;
  onAnswerAgentQuestion?: (questionId: string, answer: string) => void;
  onSkipAgentQuestion?: (questionId: string) => void;
  onRefineDraft?: () => void;
  refining?: boolean;
  wordCountWarnings?: Record<string, { word_limit: number; actual: number; overage: number }>;
  missingSections?: string[];
  overviewFigureUrl?: string | null;
  overviewFigureAlt?: string | null;
  generatingFigure?: boolean;
  onGenerateFigure?: (customInstructions?: string) => void;
}

const PHASE_LABELS: Record<DraftProgress['phase'], string> = {
  planning: 'Planning research strategy…',
  researching: 'Researching sections in parallel…',
  drafting: 'Drafting sections…',
  assembling: 'Assembling & compliance check…',
  complete: 'Draft complete',
};

const DRAFT_PHASE_ORDER: DraftProgress['phase'][] = ['planning', 'researching', 'drafting', 'assembling', 'complete'];

function draftProgressToSteps(progress: DraftProgress | null): AIThinkingStep[] {
  return DRAFT_PHASE_ORDER.map((phase) => {
    const currentIdx = progress ? DRAFT_PHASE_ORDER.indexOf(progress.phase) : -1;
    const thisIdx = DRAFT_PHASE_ORDER.indexOf(phase);
    const status: AIThinkingStep['status'] =
      !progress ? 'pending' :
      thisIdx < currentIdx ? 'done' :
      thisIdx === currentIdx ? 'active' :
      'pending';

    let label = PHASE_LABELS[phase];
    if (progress && phase === 'drafting' && status === 'active') {
      if (progress.section) label = `Drafting: ${progress.section}`;
      if (progress.total) label += ` (${(progress.index ?? 0) + 1}/${progress.total})`;
    }
    if (progress && phase === 'researching' && status === 'active') {
      if (progress.researchTotal) {
        label += ` (${progress.researchDone ?? 0}/${progress.researchTotal})`;
      }
    }

    return { id: phase, label, status };
  });
}

export default function SkeletonPhase({
  skeleton,
  onSkeletonChange,
  onGenerateDraft,
  generating,
  draftProgress,
  onSelectionChange: _onSelectionChange,
  metaAgentEvents = [],
  agentQuestions = [],
  coherenceResult,
  onAnswerAgentQuestion,
  onSkipAgentQuestion,
  onRefineDraft,
  refining = false,
  wordCountWarnings = {},
  missingSections = [],
  overviewFigureUrl,
  overviewFigureAlt,
  generatingFigure = false,
  onGenerateFigure,
}: SkeletonPhaseProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(skeleton.title_suggestion || '');

  const rawText = skeleton.raw_text || '';
  const flaggedSections: string[] = (skeleton.flagged_sections as string[]) || [];
  const hasContent = rawText.trim().length > 0;
  const flagCount = flaggedSections.length;

  const commitTitle = () => {
    setEditingTitle(false);
    onSkeletonChange({ ...skeleton, title_suggestion: titleDraft });
  };

  const handleRawTextChange = (text: string) => {
    onSkeletonChange({ ...skeleton, raw_text: text });
  };

  const handleFlaggedChange = (names: string[]) => {
    onSkeletonChange({ ...skeleton, flagged_sections: names });
  };

  const handleGenerateDraft = () => {
    onGenerateDraft(flaggedSections);
  };

  const progressPct = (() => {
    if (!draftProgress) return 0;
    if (draftProgress.phase === 'planning') return 5;
    if (draftProgress.phase === 'researching') {
      const done = draftProgress.researchDone ?? 0;
      const total = draftProgress.researchTotal ?? 1;
      return 10 + Math.round((done / total) * 30);
    }
    if (draftProgress.phase === 'drafting') {
      const idx = draftProgress.index ?? 0;
      const total = draftProgress.total ?? 1;
      return 40 + Math.round((idx / total) * 50);
    }
    if (draftProgress.phase === 'assembling') return 92;
    return 100;
  })();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scrollable document body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-8 pt-8 pb-6 space-y-3">

          {/* Proposal title */}
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

          {/* Flag hint */}
          {hasContent && !generating && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
              <span>
                Star sections to prioritise them in draft generation. If none are starred, all sections will be drafted.
              </span>
            </div>
          )}

          {/* Section divider */}
          <div className="border-t border-gray-200 pt-2" />

          {/* Single document editor */}
          {hasContent ? (
            <SkeletonEditor
              rawText={rawText}
              onChange={handleRawTextChange}
              flaggedSections={flaggedSections}
              onFlaggedChange={handleFlaggedChange}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400 space-y-3">
              <BookOpen className="w-8 h-8 text-gray-200" />
              <p className="text-sm">No skeleton yet. Generate a skeleton from the Idea tab to get started.</p>
            </div>
          )}

          {/* Draft progress */}
          {generating && (
            <div className="pt-4">
              <AIThinkingLog
                steps={draftProgressToSteps(draftProgress ?? null)}
                progressPct={progressPct}
                title={draftProgress
                  ? PHASE_LABELS[draftProgress.phase] ?? 'Generating draft…'
                  : 'Starting…'}
              />
            </div>
          )}

          {/* Word count warnings */}
          {Object.keys(wordCountWarnings).length > 0 && !generating && (
            <div className="pt-3 space-y-1.5">
              {Object.entries(wordCountWarnings).map(([section, info]) => (
                <div key={section} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>
                    <strong>{section}</strong>: {info.actual.toLocaleString()} words (limit {info.word_limit.toLocaleString()}, over by {info.overage.toLocaleString()})
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Missing required sections */}
          {missingSections.length > 0 && !generating && (
            <div className="pt-3">
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  Required sections not drafted:
                </div>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  {missingSections.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Overview figure */}
          {overviewFigureUrl && !generating && (
            <div className="pt-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <ImageIcon className="w-3.5 h-3.5" />
                Overview Figure
              </div>
              <img
                src={overviewFigureUrl}
                alt={overviewFigureAlt || 'Grant overview figure'}
                className="w-full rounded-lg border border-gray-200 shadow-sm"
              />
            </div>
          )}

          {/* Meta-agent activity panel */}
          {(metaAgentEvents.length > 0 || agentQuestions.length > 0 || coherenceResult) && (
            <div className="pt-4">
              <MetaAgentPanel
                events={metaAgentEvents}
                questions={agentQuestions}
                onAnswerQuestion={onAnswerAgentQuestion ?? (() => {})}
                onSkipQuestion={onSkipAgentQuestion ?? (() => {})}
                coherenceResult={coherenceResult ?? null}
                visible
              />
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 border-t border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-400 flex-1 min-w-0">
          {flagCount > 0
            ? <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400 text-amber-400" /> <span className="font-medium text-amber-600">{flagCount} section{flagCount > 1 ? 's' : ''} flagged</span> — will be drafted first</span>
            : 'Edit your skeleton, then generate the full draft'
          }
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {/* Refine Draft button — shown after draft with pending questions */}
          {agentQuestions.some((q) => q.answer && !q.skipped) && !generating && onRefineDraft && (
            <button
              onClick={onRefineDraft}
              disabled={refining}
              className="flex items-center gap-2 bg-amber-500 text-white text-sm px-4 py-2.5 rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {refining ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {refining ? 'Refining…' : 'Refine Draft'}
            </button>
          )}

          {/* Generate Figure button */}
          {hasContent && !generating && onGenerateFigure && (
            <button
              onClick={() => onGenerateFigure()}
              disabled={generatingFigure}
              title="Generate an AI overview figure for this grant"
              className="flex items-center gap-2 bg-violet-600 text-white text-sm px-4 py-2.5 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generatingFigure ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              {generatingFigure ? 'Generating…' : overviewFigureUrl ? 'Regenerate Figure' : 'Generate Figure'}
            </button>
          )}
          <button
            onClick={handleGenerateDraft}
            disabled={!hasContent || generating}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'Generating…' : 'Generate Full Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
