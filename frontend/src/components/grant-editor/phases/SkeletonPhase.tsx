'use client';

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react';
import { Loader2, Sparkles, Star, BookOpen, RefreshCw, ImageIcon, AlertTriangle, ChevronDown, Lock, Unlock, PlusCircle, X } from 'lucide-react';
import { grantWriting } from '@/lib/api';
import SkeletonEditor from '../SkeletonEditor';
import MetaAgentPanel from '../MetaAgentPanel';
import AIThinkingLog from '../AIThinkingLog';
import type { AIThinkingStep } from '../AIThinkingLog';
import type { AIThinkingStepData } from '@/lib/callAnalysisStore';
import type { MetaAgentEvent, AgentQuestion } from '../MetaAgentPanel';
import type { CoherenceResult } from '../WorkspaceContext';

export interface SkeletonSection {
  name: string;
  word_limit?: number | null;
  page_limit?: string | null;
  priority?: string;
  order?: number;
}

interface SkeletonPhaseProps {
  grantId: string;
  skeleton: {
    raw_text?: string;
    flagged_sections?: string[];
    title_suggestion?: string;
    narrative_arc?: string;
    key_messages?: string[];
    sections?: SkeletonSection[];
    total_word_limit?: number | null;
    total_page_limit?: string | null;
    alignment_score?: number | null;
    compliance_gaps?: string[];
    review?: {
      compliance_gaps?: string[];
      weak_sections?: string[];
      missing_call_requirements?: string[];
      alignment_score?: number | null;
      alignment_notes?: string;
    };
  };
  onSkeletonChange: (skeleton: Record<string, unknown>) => void;
  onGenerateDraft: (flaggedSections: string[]) => void;
  generating: boolean;
  draftSteps?: AIThinkingStepData[] | null;
  draftError?: string | null;
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
  draftExecutionPlan?: Record<string, unknown> | null;
  draftQaReport?: Record<string, unknown> | null;
  documentConstraints?: Record<string, unknown>;
}

interface ResearchCoverageRow {
  section?: string;
  research_tier?: string;
  exemplar_count?: number;
  key_evidence_count?: number;
  degraded?: boolean;
}

interface EvidenceCoverageRow {
  section?: string;
  exemplar_count?: number;
  verify_count?: number;
  passed?: boolean;
  issues?: string[];
}


/** Parse ## headings from raw_text and tally word count per section */
function computeSectionWordCounts(rawText: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let currentSection: string | null = null;
  let currentWords = 0;
  for (const line of rawText.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentSection !== null) counts[currentSection] = currentWords;
      currentSection = line.replace(/^##\s+/, '').trim();
      currentWords = 0;
    } else if (currentSection !== null) {
      currentWords += line.trim().split(/\s+/).filter(Boolean).length;
    }
  }
  if (currentSection !== null) counts[currentSection] = currentWords;
  return counts;
}


function AlignmentReviewPanel({
  complianceGaps,
  review,
}: {
  complianceGaps: string[];
  review?: {
    compliance_gaps?: string[];
    weak_sections?: string[];
    missing_call_requirements?: string[];
    alignment_score?: number | null;
    alignment_notes?: string;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const weakSections = review?.weak_sections || [];
  const missingReqs = review?.missing_call_requirements || [];
  const totalIssues = complianceGaps.length + weakSections.length + missingReqs.length;

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-200 px-2.5 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        {totalIssues} review flag{totalIssues !== 1 ? 's' : ''}
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg border border-orange-100 bg-orange-50 p-3 space-y-2 text-xs max-w-xl">
          {review?.alignment_notes && (
            <p className="text-orange-800 italic">{review.alignment_notes}</p>
          )}
          {complianceGaps.length > 0 && (
            <div>
              <p className="font-semibold text-orange-900 mb-1">Compliance gaps</p>
              <ul className="space-y-0.5">
                {complianceGaps.map((g, i) => (
                  <li key={i} className="flex gap-1.5 text-orange-700">
                    <span className="text-orange-400 shrink-0">✗</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {weakSections.length > 0 && (
            <div>
              <p className="font-semibold text-orange-900 mb-1">Weak sections</p>
              <ul className="space-y-0.5">
                {weakSections.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-orange-700">
                    <span className="text-orange-400 shrink-0">⚠</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missingReqs.length > 0 && (
            <div>
              <p className="font-semibold text-orange-900 mb-1">Missing requirements</p>
              <ul className="space-y-0.5">
                {missingReqs.map((r, i) => (
                  <li key={i} className="flex gap-1.5 text-orange-700">
                    <span className="text-orange-400 shrink-0">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SkeletonPhase({
  grantId,
  skeleton,
  onSkeletonChange,
  onGenerateDraft,
  generating,
  draftSteps,
  draftError,
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
  draftExecutionPlan,
  draftQaReport,
  documentConstraints = {},
}: SkeletonPhaseProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(skeleton.title_suggestion || '');
  const [placeholdersExpanded, setPlaceholdersExpanded] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // TBD counts
  const tbdCount = (skeleton as Record<string, unknown>).tbd_count as number | undefined;
  const tbdFilledCount = (skeleton as Record<string, unknown>).tbd_filled_count as number | undefined;
  const remainingTbds = tbdCount != null && tbdFilledCount != null ? tbdCount - tbdFilledCount : tbdCount;
  const flaggedSectionsFromScan: string[] = (skeleton.flagged_sections || []) as string[];

  // Document Constraints panel state
  const [constraintsExpanded, setConstraintsExpanded] = useState(true);
  const [constraintsEditing, setConstraintsEditing] = useState(false);
  const [constraintSections, setConstraintSections] = useState<SkeletonSection[]>(
    skeleton.sections ?? []
  );
  const [constraintWordLimit, setConstraintWordLimit] = useState<string>(
    skeleton.total_word_limit ? String(skeleton.total_word_limit) : ''
  );
  const [constraintPageLimit, setConstraintPageLimit] = useState<string>(
    skeleton.total_page_limit ?? ''
  );
  const [constraintSaving, setConstraintSaving] = useState(false);

  // Keep constraint state in sync when skeleton prop changes (e.g. after generation)
  useEffect(() => {
    setConstraintSections(skeleton.sections ?? []);
    setConstraintWordLimit(skeleton.total_word_limit ? String(skeleton.total_word_limit) : '');
    setConstraintPageLimit(skeleton.total_page_limit ?? '');
  }, [skeleton.sections, skeleton.total_word_limit, skeleton.total_page_limit]);

  const rawText = skeleton.raw_text || '';
  const constraintsAudit = (skeleton.constraints_audit as Record<string, unknown>) || {};
  const constraintsConfidence = (documentConstraints?.confidence as string) || '';
  const sectionWordSum = constraintSections.reduce((sum, s) => sum + (s.word_limit || 0), 0);
  const totalWordsNum = constraintWordLimit ? parseInt(constraintWordLimit.replace(/,/g, ''), 10) : 0;
  const sumMismatch = totalWordsNum > 0 && sectionWordSum > 0 && Math.abs(sectionWordSum - totalWordsNum) > totalWordsNum * 0.05;
  const flaggedSections: string[] = (skeleton.flagged_sections as string[]) || [];
  const hasContent = rawText.trim().length > 0;
  const flagCount = flaggedSections.length;

  const sectionWordCounts = computeSectionWordCounts(rawText);

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

  const handleSaveConstraints = useCallback(async () => {
    setConstraintSaving(true);
    try {
      const payload = {
        total_word_limit: constraintWordLimit ? parseInt(constraintWordLimit.replace(/,/g, ''), 10) || null : null,
        total_page_limit: constraintPageLimit || null,
        sections: constraintSections.map((s, i) => ({ ...s, order: s.order ?? i + 1 })),
      };
      const res = await grantWriting.updateSkeletonConstraints(grantId, payload);
      if (res.data?.proposal_skeleton) {
        onSkeletonChange(res.data.proposal_skeleton);
      }
      setConstraintsEditing(false);
    } catch {
      // silently keep editing open on error
    } finally {
      setConstraintSaving(false);
    }
  }, [grantId, constraintWordLimit, constraintPageLimit, constraintSections, onSkeletonChange]);

  const progressPct = (() => {
    if (!draftSteps || draftSteps.length === 0) return 5;
    const done = draftSteps.filter((s) => s.status === 'done').length;
    return Math.round(5 + (done / draftSteps.length) * 90);
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

          {/* Alignment score + review badges */}
          {(skeleton.alignment_score != null || (skeleton.compliance_gaps && skeleton.compliance_gaps.length > 0)) && (
            <div className="flex items-center gap-2 flex-wrap">
              {skeleton.alignment_score != null && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                  skeleton.alignment_score >= 75
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : skeleton.alignment_score >= 50
                    ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  {skeleton.alignment_score}% aligned to call
                </span>
              )}
              {skeleton.compliance_gaps && skeleton.compliance_gaps.length > 0 && (
                <AlignmentReviewPanel
                  complianceGaps={skeleton.compliance_gaps}
                  review={skeleton.review}
                />
              )}
            </div>
          )}

          {/* TBD badge row */}
          {remainingTbds != null && remainingTbds > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setPlaceholdersExpanded(v => !v)}
                className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 border border-yellow-200 px-2.5 py-0.5 text-xs font-medium text-yellow-700 hover:bg-yellow-100 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6m-6 4h4"/></svg>
                {remainingTbds} placeholder{remainingTbds !== 1 ? 's' : ''} to complete
                {tbdFilledCount != null && tbdFilledCount > 0 && (
                  <span className="text-yellow-500">({tbdFilledCount} auto-filled)</span>
                )}
                <ChevronDown className={`w-3 h-3 transition-transform ${placeholdersExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}

          {/* Placeholders panel */}
          {placeholdersExpanded && flaggedSectionsFromScan.length > 0 && (
            <div className="rounded-lg border border-yellow-100 bg-yellow-50 p-3 space-y-2 text-xs">
              <p className="font-semibold text-yellow-800">Sections with unfilled placeholders</p>
              <ul className="space-y-1">
                {flaggedSectionsFromScan.map((sec, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-yellow-700">
                    <span>·</span>
                    <span>{sec}</span>
                  </li>
                ))}
              </ul>
              <p className="text-yellow-600 text-xs mt-1">
                Add the missing information to your grant idea before generating the full draft, or fill in the [TBD:] markers directly in the outline below.
              </p>
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

          {/* Document Constraints Panel */}
          {(constraintSections.length > 0 || constraintWordLimit || constraintPageLimit) && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                <button
                  type="button"
                  onClick={() => setConstraintsExpanded(!constraintsExpanded)}
                  className="flex items-center gap-1.5 flex-1 text-left"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-gray-500 transition-transform ${constraintsExpanded ? '' : '-rotate-90'}`}
                  />
                  <span className="text-xs font-semibold text-gray-600">Document Constraints</span>
                  {!constraintsExpanded && constraintSections.length > 0 && (
                    <span className="text-xs text-gray-400">{constraintSections.length} sections</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConstraintsEditing(!constraintsEditing)}
                  className="text-gray-400 hover:text-indigo-600 transition-colors"
                  title={constraintsEditing ? 'Lock constraints' : 'Edit constraints'}
                >
                  {constraintsEditing ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                </button>
              </div>

              {constraintsExpanded && (
                <div className="p-3 space-y-3">
                  {constraintsConfidence && constraintsConfidence !== 'high' && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                      Limits confidence: <span className="font-medium">{constraintsConfidence}</span>
                      {Array.isArray(documentConstraints?.verification_notes) &&
                        (documentConstraints.verification_notes as string[]).slice(0, 2).map((n, i) => (
                          <span key={i} className="block mt-0.5 text-amber-600">{n}</span>
                        ))}
                    </p>
                  )}
                  {/* Document totals */}
                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 text-gray-500">
                      Total words
                      {constraintsEditing ? (
                        <input
                          type="text"
                          value={constraintWordLimit}
                          onChange={(e) => setConstraintWordLimit(e.target.value)}
                          placeholder="—"
                          className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      ) : (
                        <span className="font-medium text-gray-700">{constraintWordLimit ? Number(constraintWordLimit).toLocaleString() : '—'}</span>
                      )}
                    </label>
                    <label className="flex items-center gap-1.5 text-gray-500">
                      Total pages
                      {constraintsEditing ? (
                        <input
                          type="text"
                          value={constraintPageLimit}
                          onChange={(e) => setConstraintPageLimit(e.target.value)}
                          placeholder="—"
                          className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      ) : (
                        <span className="font-medium text-gray-700">{constraintPageLimit || '—'}</span>
                      )}
                    </label>
                  </div>

                  {/* Sections table */}
                  {constraintSections.length > 0 && (
                    <div className="border border-gray-100 rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-gray-400 font-medium">
                            {constraintsEditing && <th className="px-2 py-1.5 w-6" />}
                            <th className="text-left px-2 py-1.5 w-6">#</th>
                            <th className="text-left px-2 py-1.5">Section</th>
                            <th className="text-right px-2 py-1.5 w-24">Target words</th>
                            <th className="text-right px-2 py-1.5 w-24">Skeleton words</th>
                            <th className="text-right px-2 py-1.5 w-16">Pages</th>
                            <th className="text-left px-2 py-1.5 w-20">Priority</th>
                            {constraintsEditing && <th className="w-8" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {constraintSections.map((sc, idx) => {
                            const actual = sectionWordCounts[sc.name] ?? 0;
                            const limit = sc.word_limit;
                            const overLimit = limit && actual > limit;
                            const nearLimit = limit && !overLimit && actual > limit * 0.85;
                            return (
                              <tr
                                key={idx}
                                draggable={constraintsEditing}
                                onDragStart={constraintsEditing ? (e: DragEvent) => {
                                  dragIndexRef.current = idx;
                                  e.dataTransfer.effectAllowed = 'move';
                                } : undefined}
                                onDragOver={constraintsEditing ? (e: DragEvent) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'move';
                                  setDragOverIdx(idx);
                                } : undefined}
                                onDragLeave={constraintsEditing ? () => setDragOverIdx(null) : undefined}
                                onDrop={constraintsEditing ? (e: DragEvent) => {
                                  e.preventDefault();
                                  const from = dragIndexRef.current;
                                  if (from === null || from === idx) { setDragOverIdx(null); return; }
                                  const updated = [...constraintSections];
                                  const [moved] = updated.splice(from, 1);
                                  updated.splice(idx, 0, moved);
                                  setConstraintSections(updated.map((s, i) => ({ ...s, order: i + 1 })));
                                  dragIndexRef.current = null;
                                  setDragOverIdx(null);
                                } : undefined}
                                onDragEnd={constraintsEditing ? () => { dragIndexRef.current = null; setDragOverIdx(null); } : undefined}
                                className={`group transition-colors ${constraintsEditing && dragOverIdx === idx ? 'bg-indigo-50 border-t-2 border-indigo-300' : 'hover:bg-gray-50'}`}
                              >
                                {constraintsEditing && (
                                  <td className="px-2 py-1.5 text-gray-300 cursor-grab active:cursor-grabbing select-none">
                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                                      <circle cx="9" cy="6" r="1.5" fill="currentColor"/>
                                      <circle cx="15" cy="6" r="1.5" fill="currentColor"/>
                                      <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
                                      <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
                                      <circle cx="9" cy="18" r="1.5" fill="currentColor"/>
                                      <circle cx="15" cy="18" r="1.5" fill="currentColor"/>
                                    </svg>
                                  </td>
                                )}
                                <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                                <td className="px-2 py-1.5">
                                  {constraintsEditing ? (
                                    <input
                                      value={sc.name}
                                      onChange={(e) => {
                                        const u = [...constraintSections];
                                        u[idx] = { ...sc, name: e.target.value };
                                        setConstraintSections(u);
                                      }}
                                      className="w-full bg-transparent focus:outline-none focus:bg-indigo-50 rounded px-0.5"
                                    />
                                  ) : (
                                    <span className="text-gray-700">{sc.name}</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {constraintsEditing ? (
                                    <input
                                      type="number"
                                      value={sc.word_limit ?? ''}
                                      onChange={(e) => {
                                        const u = [...constraintSections];
                                        u[idx] = { ...sc, word_limit: e.target.value ? Number(e.target.value) : null };
                                        setConstraintSections(u);
                                      }}
                                      placeholder="—"
                                      className="w-20 bg-transparent focus:outline-none focus:bg-indigo-50 rounded px-0.5 text-right"
                                    />
                                  ) : (
                                    <span className="font-medium text-gray-800">
                                      {limit ? limit.toLocaleString() : '—'}
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {!constraintsEditing && (
                                    <span className={
                                      overLimit ? 'text-red-600' :
                                      nearLimit ? 'text-amber-600' :
                                      'text-gray-400'
                                    } title="Words in skeleton bullets (draft outline, not final target)">
                                      {actual > 0 ? actual.toLocaleString() : '—'}
                                    </span>
                                  )}
                                  {constraintsEditing && <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {constraintsEditing ? (
                                    <input
                                      type="text"
                                      value={sc.page_limit ?? ''}
                                      onChange={(e) => {
                                        const u = [...constraintSections];
                                        u[idx] = { ...sc, page_limit: e.target.value || null };
                                        setConstraintSections(u);
                                      }}
                                      placeholder="—"
                                      className="w-12 bg-transparent focus:outline-none focus:bg-indigo-50 rounded px-0.5 text-right"
                                    />
                                  ) : (
                                    <span className="text-gray-600">{sc.page_limit || '—'}</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5">
                                  {constraintsEditing ? (
                                    <select
                                      value={sc.priority ?? 'medium'}
                                      onChange={(e) => {
                                        const u = [...constraintSections];
                                        u[idx] = { ...sc, priority: e.target.value };
                                        setConstraintSections(u);
                                      }}
                                      className="bg-transparent focus:outline-none text-xs text-gray-500"
                                    >
                                      <option value="high">high</option>
                                      <option value="medium">med</option>
                                      <option value="low">low</option>
                                    </select>
                                  ) : (
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                      sc.priority === 'high' ? 'bg-red-50 text-red-600' :
                                      sc.priority === 'low' ? 'bg-gray-100 text-gray-500' :
                                      'bg-amber-50 text-amber-600'
                                    }`}>{sc.priority ?? 'med'}</span>
                                  )}
                                </td>
                                {constraintsEditing && (
                                  <td className="px-1 py-1.5 text-right">
                                    <button
                                      type="button"
                                      onClick={() => setConstraintSections(constraintSections.filter((_, i) => i !== idx))}
                                      className="text-gray-300 hover:text-red-500 transition-colors"
                                      title="Remove section"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!constraintsEditing && totalWordsNum > 0 && (
                        <p className={`text-xs px-2 py-1.5 border-t border-gray-100 ${sumMismatch ? 'text-amber-700 bg-amber-50' : 'text-gray-500'}`}>
                          Section targets sum: {sectionWordSum.toLocaleString()}
                          {' / '}
                          {totalWordsNum.toLocaleString()} total words
                          {sumMismatch ? ' — adjust section targets to match document total' : ''}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Edit-mode actions */}
                  {constraintsEditing && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setConstraintSections([
                            ...constraintSections,
                            { name: 'New Section', word_limit: null, page_limit: null, priority: 'medium', order: constraintSections.length + 1 },
                          ])
                        }
                        className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700"
                      >
                        <PlusCircle className="w-3 h-3" />
                        Add section
                      </button>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={handleSaveConstraints}
                        disabled={constraintSaving}
                        className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {constraintSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Save constraints
                      </button>
                    </div>
                  )}
                </div>
              )}
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
            <div className="pt-4 space-y-3">
              <AIThinkingLog
                steps={(draftSteps ?? []).map((s) => ({ id: s.id, label: s.label, status: s.status as AIThinkingStep['status'], detail: s.detail }))}
                progressPct={progressPct}
                title="Generating draft…"
              />
              {(() => {
                const coverage = ((draftExecutionPlan?.research_coverage ?? []) as ResearchCoverageRow[]);
                if (coverage.length === 0) return null;
                return (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
                    <div className="font-medium text-gray-700 mb-1.5">Section evidence (live)</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {coverage.map((row, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-gray-600">
                          <span className="truncate">{row.section}</span>
                          <span className="shrink-0 flex items-center gap-1.5">
                            <span className="text-gray-400">{row.research_tier}</span>
                            <span>{row.exemplar_count ?? 0} ex / {row.key_evidence_count ?? 0} claims</span>
                            {row.degraded && (
                              <span className="text-amber-700 bg-amber-50 px-1 rounded" title="No archive hits">⚠</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {draftError && !generating && (
            <div className="pt-3 flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{draftError}</span>
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


          {draftQaReport && !generating && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm space-y-2">
              <div className="font-medium text-slate-900">Draft quality report</div>
              {(() => {
                const research = (draftQaReport.research_coverage ?? []) as ResearchCoverageRow[];
                const evidence = (draftQaReport.evidence_coverage ?? []) as EvidenceCoverageRow[];
                const failed = evidence.filter((e) => e.passed === false);
                return (
                  <>
                    {research.length > 0 && (
                      <div className="text-xs text-gray-600 space-y-0.5 max-h-28 overflow-y-auto">
                        {research.map((row, i) => (
                          <div key={i} className="flex justify-between gap-2">
                            <span>{row.section}</span>
                            <span>{row.exemplar_count ?? 0} archive · {row.key_evidence_count ?? 0} claims ({row.research_tier})</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {failed.length > 0 && (
                      <ul className="list-disc list-inside text-xs text-amber-800">
                        {failed.slice(0, 6).map((row, i) => (
                          <li key={i}>
                            <strong>{row.section}</strong>: {(row.issues ?? []).join(' ')}
                          </li>
                        ))}
                      </ul>
                    )}
                    {failed.length === 0 && evidence.length > 0 && (
                      <p className="text-xs text-green-700">Evidence coverage checks passed for all sections.</p>
                    )}
                    {Array.isArray(draftQaReport.constraints_issues) && (draftQaReport.constraints_issues as string[]).length > 0 && (
                      <ul className="list-disc list-inside text-xs text-gray-600 mt-1">
                        {(draftQaReport.constraints_issues as string[]).slice(0, 4).map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {(localDraftPlan || draftExecutionPlan) && !generating && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm space-y-2">
              <div className="font-medium text-indigo-900">Draft execution plan</div>
              {(() => {
                const plan = (localDraftPlan || draftExecutionPlan) as Record<string, unknown>;
                const profile = (plan.document_profile || {}) as Record<string, unknown>;
                const gaps = (plan.alignment_gaps || []) as string[];
                const secs = (plan.sections || []) as Array<Record<string, unknown>>;
                return (
                  <>
                    {profile.total_target_words != null && (
                      <p className="text-indigo-800">Target document: ~{String(profile.total_target_words)} words</p>
                    )}
                    {gaps.length > 0 && (
                      <ul className="list-disc list-inside text-amber-800 text-xs">
                        {gaps.slice(0, 4).map((g, i) => <li key={i}>{g}</li>)}
                      </ul>
                    )}
                    {secs.length > 0 && (
                      <div className="text-xs text-gray-600 max-h-24 overflow-y-auto">
                        {secs.slice(0, 8).map((s, i) => (
                          <div key={i}>{String(s.section_name)} — {String(s.target_words || '?')} words ({String(s.agent || 'default')})</div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}


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
            type="button"
            onClick={async () => {
              setPreviewingPlan(true);
              try {
                const res = await grantWriting.previewDraftPlan(grantId);
                setLocalDraftPlan((res.data as { draft_execution_plan?: Record<string, unknown> }).draft_execution_plan ?? null);
              } catch { /* ignore */ }
              finally { setPreviewingPlan(false); }
            }}
            disabled={!hasContent || generating || previewingPlan}
            className="flex items-center gap-2 border border-indigo-300 text-indigo-700 text-sm px-4 py-2.5 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
          >
            {previewingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            Preview plan
          </button>
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
