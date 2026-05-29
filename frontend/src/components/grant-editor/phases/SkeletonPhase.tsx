'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, Star, BookOpen, RefreshCw, ImageIcon, AlertTriangle, ChevronDown, Lock, Unlock, PlusCircle, X, ArrowUp, ArrowDown } from 'lucide-react';
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
}: SkeletonPhaseProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(skeleton.title_suggestion || '');
  const [placeholdersExpanded, setPlaceholdersExpanded] = useState(false);

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

  const moveSection = (idx: number, dir: -1 | 1) => {
    const next = [...constraintSections];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setConstraintSections(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

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
                            <th className="text-left px-2 py-1.5 w-6">#</th>
                            <th className="text-left px-2 py-1.5">Section</th>
                            <th className="text-right px-2 py-1.5 w-28">Word count</th>
                            <th className="text-right px-2 py-1.5 w-16">Pages</th>
                            <th className="text-left px-2 py-1.5 w-20">Priority</th>
                            {constraintsEditing && <th className="w-14" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {constraintSections.map((sc, idx) => {
                            const actual = sectionWordCounts[sc.name] ?? 0;
                            const limit = sc.word_limit;
                            const overLimit = limit && actual > limit;
                            const nearLimit = limit && !overLimit && actual > limit * 0.85;
                            return (
                              <tr key={idx} className="group hover:bg-gray-50">
                                <td className="px-2 py-1.5 text-gray-400">{sc.order ?? idx + 1}</td>
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
                                    <span className={
                                      overLimit ? 'text-red-600 font-medium' :
                                      nearLimit ? 'text-amber-600' :
                                      'text-gray-600'
                                    }>
                                      {actual > 0 ? actual.toLocaleString() : '—'}
                                      {limit ? ` / ${limit.toLocaleString()}` : ''}
                                    </span>
                                  )}
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
                                  <td className="px-1 py-1.5">
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button type="button" onClick={() => moveSection(idx, -1)} className="text-gray-400 hover:text-gray-600">
                                        <ArrowUp className="w-3 h-3" />
                                      </button>
                                      <button type="button" onClick={() => moveSection(idx, 1)} className="text-gray-400 hover:text-gray-600">
                                        <ArrowDown className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConstraintSections(constraintSections.filter((_, i) => i !== idx))}
                                        className="text-gray-300 hover:text-red-500 ml-0.5"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
            <div className="pt-4">
              <AIThinkingLog
                steps={(draftSteps ?? []).map((s) => ({ id: s.id, label: s.label, status: s.status as AIThinkingStep['status'], detail: s.detail }))}
                progressPct={progressPct}
                title="Generating draft…"
              />
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
