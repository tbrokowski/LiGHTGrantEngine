'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { grants, grantWriting } from '@/lib/api';
const grantWritingApi = grantWriting;

import {
  isMarkedAnalyzing,
  type CallAnalysisStatus,
  type AIThinkingStepData,
  isSkeletonGenerating,
  startSkeletonGeneration,
  completeSkeletonGeneration,
  resetSkeletonGeneration,
  pollSkeletonUntilDone,
  isDraftGenerating,
  startDraftGeneration,
  completeDraftGeneration,
  resetDraftGeneration,
  pollDraftUntilDone,
} from '@/lib/callAnalysisStore';
import UnifiedWorkspace from './UnifiedWorkspace';
import AIChatPanel from './AIChatPanel';
import WorkspaceContext, { type SyncState, type WorkspaceCitation, type CoherenceResult } from './WorkspaceContext';
import type { MetaAgentEvent, AgentQuestion } from './MetaAgentPanel';
import { AlertCircle, Sparkles } from 'lucide-react';
import type { PanelTabType } from './split-view/types';

interface GrantDetail {
  id: string;
  title: string;
  funder: string | null;
  call_requirements: string | null;
  editor_sections: Record<string, unknown>;
  editor_document?: string | null;
  google_doc_id?: string | null;
  google_doc_url?: string | null;
  google_doc_last_synced?: string | null;
  grant_idea?: string | null;
  call_analysis?: Record<string, unknown>;
  proposal_skeleton?: Record<string, unknown>;
  style_profile?: Record<string, unknown>;
  writing_phase?: string;
  last_review?: Record<string, unknown>;
  overview_figure_url?: string | null;
  overview_figure_alt?: string | null;
}

interface GrantEditorProps {
  grant: GrantDetail;
  onGrantUpdate: () => void;
  onHeadingsChange?: (headings: string[]) => void;
}

// Returns the best default panel type for the grant's current phase
function defaultPanelType(writingPhase?: string): PanelTabType {
  if (writingPhase === 'skeleton') return 'skeleton';
  if (writingPhase === 'draft') return 'editor';
  return 'idea';
}

export default function GrantEditor({ grant, onGrantUpdate, onHeadingsChange }: GrantEditorProps) {
  // ── Core content state ──────────────────────────────────────────────────────
  const [grantIdea, setGrantIdea] = useState(grant.grant_idea || '');
  const [callAnalysis, setCallAnalysis] = useState<Record<string, unknown>>(grant.call_analysis || {});
  const [skeleton, setSkeleton] = useState<Record<string, unknown>>(grant.proposal_skeleton || {});
  const [documentHtml, setDocumentHtml] = useState(grant.editor_document || '');
  const [callRequirements, setCallRequirements] = useState(grant.call_requirements || '');
  const [callAnalysisStatus, setCallAnalysisStatus] = useState<CallAnalysisStatus>('idle');
  const [selectedText, setSelectedText] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [activePhaseContext, setActivePhaseContext] = useState(grant.writing_phase || 'idea');
  const [activeDocHtml, setActiveDocHtml] = useState(grant.editor_document || '');
  const [activeDocLabel, setActiveDocLabel] = useState('Draft');

  // ── Generation state ─────────────────────────────────────────────────────────
  const [generatingSkeleton, setGeneratingSkeleton] = useState(false);
  const [skeletonSteps, setSkeletonSteps] = useState<AIThinkingStepData[] | null>(null);
  const [skeletonError, setSkeletonError] = useState<string | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftSteps, setDraftSteps] = useState<AIThinkingStepData[] | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [wordCountWarnings, setWordCountWarnings] = useState<Record<string, {word_limit: number; actual: number; overage: number}>>({});
  const [missingSections, setMissingSections] = useState<string[]>([]);
  // Figure generation
  const [overviewFigureUrl, setOverviewFigureUrl] = useState<string | null>(grant.overview_figure_url || null);
  const [overviewFigureAlt, setOverviewFigureAlt] = useState<string | null>(grant.overview_figure_alt || null);
  const [generatingFigure, setGeneratingFigure] = useState(false);

  // ── Meta-agent state ──────────────────────────────────────────────────────────
  const [metaAgentEvents, setMetaAgentEvents] = useState<MetaAgentEvent[]>([]);
  const [agentQuestions, setAgentQuestions] = useState<AgentQuestion[]>([]);
  const [coherenceResult, setCoherenceResult] = useState<CoherenceResult | null>(null);
  const [refiningDraft, setRefiningDraft] = useState(false);

  const handleGenerateFigure = async (customInstructions?: string) => {
    if (generatingFigure) return;
    setGeneratingFigure(true);
    try {
      const resp = await grantWritingApi.generateFigure(grant.id, customInstructions);
      if (resp.data?.figure_url) {
        setOverviewFigureUrl(resp.data.figure_url);
        setOverviewFigureAlt(resp.data.alt_text || 'Grant overview figure');
        onGrantUpdate();
      }
    } catch (err) {
      console.error('Figure generation failed', err);
    } finally {
      setGeneratingFigure(false);
    }
  };

  // ── Review / citations ───────────────────────────────────────────────────────
  const [reviewReport, setReviewReport] = useState<Record<string, unknown> | null>(grant.last_review || null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [citations, setCitations] = useState<WorkspaceCitation[]>([]);

  // ── Google Docs sync ─────────────────────────────────────────────────────────
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [docLinked, setDocLinked] = useState(!!grant.google_doc_id);
  const [docUrl, setDocUrl] = useState(grant.google_doc_url || '');
  const [lastSynced, setLastSynced] = useState(grant.google_doc_last_synced || '');
  const [remoteChangePending, setRemoteChangePending] = useState(false);

  // ── AI sidebar + Comments panel ───────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 340;
    return parseInt(localStorage.getItem(`aiSidebarWidth:${grant.id}`) || '340');
  });
  const aiDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ideaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const googlePushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSyncInProgress = useRef(false);
  const docChangedSinceLastPush = useRef(false);
  const docLinkedRef = useRef(!!grant.google_doc_id);
  const isMountedRef = useRef(false);
  const onGrantUpdateRef = useRef(onGrantUpdate);
  const activeDocLabelRef = useRef('Draft');
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Exposed to UnifiedWorkspace so skeleton/draft generation can open the right panel
  const openPanelRef = useRef<((type: PanelTabType) => void) | null>(null);

  useEffect(() => { onGrantUpdateRef.current = onGrantUpdate; });
  useEffect(() => { docLinkedRef.current = docLinked; }, [docLinked]);

  // ── Skeleton generation helpers ──────────────────────────────────────────────
  const runSkeletonPoll = useCallback(async () => {
    try {
      const data = await pollSkeletonUntilDone(grant.id, (progress) => {
        if (progress.skeleton_steps && progress.skeleton_steps.length > 0) {
          setSkeletonSteps(progress.skeleton_steps as AIThinkingStepData[]);
        }
      });
      completeSkeletonGeneration(grant.id);
      if (data.proposal_skeleton && Object.keys(data.proposal_skeleton).length) {
        setSkeleton(data.proposal_skeleton as Record<string, unknown>);
        openPanelRef.current?.('skeleton');
      }
      onGrantUpdateRef.current();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Skeleton generation failed.';
      setSkeletonError(msg);
      resetSkeletonGeneration(grant.id);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) {
        setGeneratingSkeleton(false);
        setSkeletonSteps(null);
      }
    }
  }, [grant.id]);

  // ── Mount effect ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    grantWriting.status(grant.id).then((res) => {
      const d = res.data;
      if (d.grant_idea) setGrantIdea(d.grant_idea as string);
      if (d.call_analysis && Object.keys(d.call_analysis as object).length) setCallAnalysis(d.call_analysis as Record<string, unknown>);
      if (d.call_requirements) setCallRequirements(d.call_requirements as string);
      if (d.call_analysis_status) setCallAnalysisStatus(d.call_analysis_status as CallAnalysisStatus);
      if (d.proposal_skeleton && Object.keys(d.proposal_skeleton as object).length) setSkeleton(d.proposal_skeleton as Record<string, unknown>);
      if (d.last_review && Object.keys(d.last_review as object).length) setReviewReport(d.last_review as Record<string, unknown>);
      if (d.editor_document) setDocumentHtml(d.editor_document as string);

      // Resume in-progress skeleton or draft jobs if still running on server
      const skelStatus = (d.skeleton_status as string) || 'idle';
      const draftStatus = (d.draft_status as string) || 'idle';

      if (skelStatus === 'running' || isSkeletonGenerating(grant.id)) {
        setGeneratingSkeleton(true);
        runSkeletonPoll();
      }
      if (draftStatus === 'running' || isDraftGenerating(grant.id)) {
        setGeneratingDraft(true);
        runDraftPoll();
      }
    }).catch(() => {});

    grantWriting.listCitations(grant.id).then((res) => setCitations(res.data)).catch(() => {});

    return () => {
      isMountedRef.current = false;
      if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
      if (googlePushTimer.current) { clearTimeout(googlePushTimer.current); googlePushTimer.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.id]);

  // ── Bidirectional Google Docs sync: poll every 15s ───────────────────────────
  // If remote changed AND local is clean → auto-pull silently.
  // If remote changed AND local is dirty → show conflict banner.
  useEffect(() => {
    if (!docLinked) return;
    const interval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (autoSyncInProgress.current) return;
      try {
        const statusRes = await grants.getDocsRemoteStatus(grant.id);
        if (!statusRes.data.has_remote_changes) return;

        if (!docChangedSinceLastPush.current) {
          // Local is clean — auto-pull silently
          autoSyncInProgress.current = true;
          setSyncState('pulling');
          const pullRes = await grants.pullFromGoogleDoc(grant.id);
          setDocumentHtml(pullRes.data.content_html || '');
          setLastSynced(pullRes.data.last_synced);
          setRemoteChangePending(false);
          setSyncState('success');
          setTimeout(() => setSyncState((s) => s === 'success' ? 'idle' : s), 3000);
        } else {
          // Both sides changed — surface conflict banner
          setRemoteChangePending(true);
        }
      } catch { /* silent fail */ } finally {
        autoSyncInProgress.current = false;
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [docLinked, grant.id]);

  // ── Callbacks ─────────────────────────────────────────────────────────────────
  const getDocumentContext = useCallback(() => {
    if (activePhaseContext === 'idea') return grantIdea;
    if (activePhaseContext === 'skeleton') return (skeleton.raw_text as string) || '';
    return activeDocHtml.replace(/<[^>]+>/g, ' ').trim();
  }, [activePhaseContext, grantIdea, skeleton, activeDocHtml]);

  const handleDocumentChange = useCallback((html: string, words: number, heads: string[]) => {
    setDocumentHtml(html);
    setWordCount(words);
    onHeadingsChange?.(heads);
    // Keep active doc in sync when the main draft is the focused document
    if (activeDocLabelRef.current === 'Draft') setActiveDocHtml(html);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await grants.saveDocument(grant.id, html, true); }
      catch (e) { console.error('Auto-save failed', e); }
    }, 1500);

    docChangedSinceLastPush.current = true;
    if (googlePushTimer.current) clearTimeout(googlePushTimer.current);
    googlePushTimer.current = setTimeout(async () => {
      if (!docChangedSinceLastPush.current) return;
      if (autoSyncInProgress.current) return;
      if (!docLinkedRef.current) return;
      autoSyncInProgress.current = true;
      docChangedSinceLastPush.current = false;
      setSyncState('pushing');
      try {
        await grants.saveDocument(grant.id, html, false);
        const res = await grants.pushToGoogleDoc(grant.id);
        setLastSynced(res.data.last_synced);
        setSyncState('success');
        setTimeout(() => setSyncState((s) => s === 'success' ? 'idle' : s), 3000);
      } catch {
        setSyncState('idle');
      } finally {
        autoSyncInProgress.current = false;
        setRemoteChangePending(false); // local is now the authority
      }
    }, 3000);
  }, [grant.id, onHeadingsChange]);

  const handleIdeaChange = (idea: string) => {
    setGrantIdea(idea);
    if (ideaTimer.current) clearTimeout(ideaTimer.current);
    ideaTimer.current = setTimeout(async () => {
      try { await grantWriting.saveIdea(grant.id, { grant_idea: idea }); }
      catch { /* ignore */ }
    }, 1000);
  };

  const runDraftPoll = useCallback(async () => {
    try {
      const data = await pollDraftUntilDone(grant.id, (progress) => {
        if (progress.draft_steps && progress.draft_steps.length > 0) {
          setDraftSteps(progress.draft_steps as AIThinkingStepData[]);
        }
      });
      completeDraftGeneration(grant.id);
      if (data.editor_document) {
        setDocumentHtml(data.editor_document as string);
        openPanelRef.current?.('editor');
      }
      // Pick up agent questions from skeleton meta data
      const skelMeta = (data.proposal_skeleton as Record<string, unknown> | undefined)?._meta_agent_questions;
      if (Array.isArray(skelMeta) && skelMeta.length > 0) {
        setAgentQuestions(skelMeta as AgentQuestion[]);
      }
      onGrantUpdateRef.current();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Draft generation failed.';
      setDraftError(msg);
      resetDraftGeneration(grant.id);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) {
        setGeneratingDraft(false);
        setDraftSteps(null);
      }
    }
  }, [grant.id]);

  const handleGenerateSkeleton = async (constraints?: import('@/components/grant-editor/phases/IdeaPhase').SkeletonConstraints) => {
    if (generatingSkeleton) return;
    setGeneratingSkeleton(true);
    setSkeletonSteps(null);
    setSkeletonError(null);
    try {
      await grantWriting.saveIdea(grant.id, { grant_idea: grantIdea, writing_phase: 'idea' });
      await grantWritingApi.enqueueSkeleton(grant.id, constraints);
      startSkeletonGeneration(grant.id);
      runSkeletonPoll();
    } catch (err) {
      console.error('Skeleton enqueue failed', err);
      toast.error('Failed to start skeleton generation. Please try again.');
      resetSkeletonGeneration(grant.id);
      setGeneratingSkeleton(false);
    }
  };

  const handleSkeletonChange = async (updated: Record<string, unknown>) => {
    setSkeleton(updated);
    try {
      await grantWriting.updateSkeleton(grant.id, { proposal_skeleton: updated, writing_phase: 'skeleton' });
    } catch { /* ignore */ }
  };

  const handleGenerateDraft = async (flaggedSections?: string[]) => {
    if (generatingDraft) return;
    setGeneratingDraft(true);
    setDraftSteps(null);
    setDraftError(null);
    setMetaAgentEvents([]);
    setAgentQuestions([]);
    setCoherenceResult(null);
    try {
      await grantWritingApi.enqueueDraft(grant.id, flaggedSections ? { flagged_sections: flaggedSections } : undefined);
      startDraftGeneration(grant.id);
      runDraftPoll();
    } catch (err) {
      console.error('Draft enqueue failed', err);
      toast.error('Failed to start draft generation. Please try again.');
      resetDraftGeneration(grant.id);
      setGeneratingDraft(false);
    }
  };

  const handleAnswerAgentQuestion = (questionId: string, answer: string) => {
    setAgentQuestions((prev) =>
      prev.map((q) => q.question_id === questionId ? { ...q, answer } : q)
    );
  };

  const handleSkipAgentQuestion = (questionId: string) => {
    setAgentQuestions((prev) =>
      prev.map((q) => q.question_id === questionId ? { ...q, skipped: true } : q)
    );
  };

  const handleRefineDraft = async () => {
    const answers = agentQuestions
      .filter((q) => q.answer && !q.skipped)
      .map((q) => ({ question_id: q.question_id, section_name: q.section, answer: q.answer! }));
    if (!answers.length) return;
    setRefiningDraft(true);
    try {
      const res = await grantWriting.refineDraft(grant.id, answers);
      if (res.data?.document_html) {
        setDocumentHtml(res.data.document_html);
        openPanelRef.current?.('editor');
      }
    } catch (err) {
      console.error('Refine draft failed', err);
    } finally {
      setRefiningDraft(false);
      onGrantUpdate();
    }
  };

  const handleRunReview = async () => {
    setReviewLoading(true);
    try {
      const res = await grantWriting.runReview(grant.id);
      setReviewReport(res.data);
    } finally {
      setReviewLoading(false);
    }
  };

  const insertIntoSection = (text: string) => {
    if (!activeSection) {
      setDocumentHtml((prev) => prev + `<p>${text}</p>`);
      return;
    }
    const regex = new RegExp(
      `(<h2[^>]*>${activeSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>)([\\s\\S]*?)(?=<h2|$)`, 'i'
    );
    if (documentHtml.match(regex)) {
      setDocumentHtml(documentHtml.replace(regex, `$1\n<p>${text}</p>$2`));
    } else {
      setDocumentHtml((prev) => prev + `<p>${text}</p>`);
    }
  };

  const extractError = (e: unknown): string => {
    const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    return detail || (e as { message?: string }).message || 'An unexpected error occurred';
  };

  const handlePushToDoc = async () => {
    setSyncState('pushing');
    setSyncError('');
    try {
      await grants.saveDocument(grant.id, documentHtml, false);
      const res = await grants.pushToGoogleDoc(grant.id);
      setLastSynced(res.data.last_synced);
      setSyncState('success');
      setTimeout(() => setSyncState('idle'), 3000);
    } catch (e: unknown) {
      setSyncError(extractError(e));
      setSyncState('error');
    }
  };

  const handlePullFromDoc = async () => {
    setSyncState('pulling');
    setSyncError('');
    try {
      const res = await grants.pullFromGoogleDoc(grant.id);
      setDocumentHtml(res.data.content_html);
      setSyncState('success');
      onGrantUpdate();
      setTimeout(() => setSyncState('idle'), 3000);
    } catch (e: unknown) {
      setSyncError(extractError(e));
      setSyncState('error');
    }
  };

  // ── AI sidebar resize ─────────────────────────────────────────────────────────
  const handleAiResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    aiDragRef.current = { startX: e.clientX, startWidth: aiWidth };
    const onMove = (ev: MouseEvent) => {
      if (!aiDragRef.current) return;
      const dx = aiDragRef.current.startX - ev.clientX;
      const next = Math.max(260, Math.min(600, aiDragRef.current.startWidth + dx));
      setAiWidth(next);
      localStorage.setItem(`aiSidebarWidth:${grant.id}`, String(next));
    };
    const onUp = () => {
      aiDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Workspace context value ───────────────────────────────────────────────────
  const contextValue = {
    grantId: grant.id,
    grantTitle: grant.title,
    grantIdea,
    callAnalysis,
    skeleton,
    documentHtml,
    callRequirements,
    selectedText,
    activeSection,
    generatingSkeleton,
    skeletonSteps,
    skeletonError,
    generatingDraft,
    draftSteps,
    draftError,
    wordCountWarnings,
    missingSections,
    overviewFigureUrl,
    overviewFigureAlt,
    generatingFigure,
    onGenerateFigure: handleGenerateFigure,
    reviewReport,
    reviewLoading,
    citations,
    syncState,
    syncError,
    docLinked,
    docUrl,
    lastSynced,
    googleDocId: grant.google_doc_id ?? null,
    remoteChangePending,
    wordCount,
    activeDocLabel,
    onActiveDocChange: (html: string, label: string) => {
      setActiveDocHtml(html);
      setActiveDocLabel(label);
      activeDocLabelRef.current = label;
    },
    onIdeaChange: handleIdeaChange,
    onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => {
      setCallAnalysis(analysis);
      if (requirements) setCallRequirements(requirements);
    },
    callAnalysisStatus,
    onCallAnalysisStatusChange: (status: CallAnalysisStatus) => {
      setCallAnalysisStatus(status);
    },
    resumeCallAnalysis:
      callAnalysisStatus === 'running' || isMarkedAnalyzing(grant.id),
    onGenerateSkeleton: handleGenerateSkeleton,
    onSkeletonChange: handleSkeletonChange,
    onGenerateDraft: handleGenerateDraft,
    onDocumentChange: handleDocumentChange,
    onSelectionChange: setSelectedText,
    onActiveSectionChange: setActiveSection,
    onPhaseContextChange: setActivePhaseContext,
    onInsertText: insertIntoSection,
    onDocLinked: (docId: string, url: string) => { setDocLinked(true); setDocUrl(url); onGrantUpdate(); },
    onUnlinkDoc: () => { setDocLinked(false); setDocUrl(''); onGrantUpdate(); },
    onDocPulled: (html: string) => { setDocumentHtml(html); openPanelRef.current?.('editor'); onGrantUpdate(); },
    onRunReview: handleRunReview,
    onCitationsUpdate: setCitations,
    onPushToDoc: handlePushToDoc,
    onPullFromDoc: handlePullFromDoc,
    onDismissRemoteChange: () => setRemoteChangePending(false),
    getDocumentContext,
    // Meta-agent
    metaAgentEvents,
    agentQuestions,
    coherenceResult,
    onAnswerAgentQuestion: handleAnswerAgentQuestion,
    onSkipAgentQuestion: handleSkipAgentQuestion,
    onRefineDraft: handleRefineDraft,
  };

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <div className="flex flex-col h-full overflow-hidden">
        {/* ── Top toolbar ───────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
          {/* Left: grant title */}
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-sm font-semibold text-gray-800 truncate max-w-[260px]" title={grant.title}>
              {grant.title}
            </h1>
            {grant.funder && (
              <span className="text-xs text-gray-400 truncate max-w-[160px]">{grant.funder}</span>
            )}
          </div>

          {/* Right: status + controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* AI sidebar toggle */}
            <button
              onClick={() => setAiOpen((v) => !v)}
              title={aiOpen ? 'Hide AI Assistant' : 'Show AI Assistant'}
              className={`p-1.5 rounded-lg transition-colors ${
                aiOpen
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-indigo-600'
              }`}
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sync error banner */}
        {syncState === 'error' && syncError && (
          <div className="flex-shrink-0 flex items-center gap-2 bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {syncError}
            <button onClick={() => { setSyncState('idle'); setSyncError(''); }} className="ml-auto">×</button>
          </div>
        )}

        {/* ── Main content: workspace + AI sidebar ─────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Unified split-panel workspace */}
          <div className="flex flex-1 min-w-0 overflow-hidden">
            <UnifiedWorkspace
              grantId={grant.id}
              defaultPanelType={defaultPanelType(grant.writing_phase)}
              openPanelRef={openPanelRef}
            />
          </div>

          {/* AI sidebar */}
          {aiOpen && (
            <div className="flex flex-shrink-0 overflow-hidden" style={{ width: aiWidth }}>
              {/* Drag handle */}
              <div
                onMouseDown={handleAiResizeMouseDown}
                className="w-1 flex-shrink-0 bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500 cursor-col-resize transition-colors select-none"
                title="Drag to resize"
              />
              <div className="flex flex-1 min-w-0 overflow-hidden">
                <AIChatPanel
                  grantId={grant.id}
                  selectedText={selectedText}
                  activeSection={activeSection}
                  writingPhase={activePhaseContext}
                  getDocumentContext={getDocumentContext}
                  onInsertText={insertIntoSection}
                  callRequirements={callRequirements}
                  useWritingStudio
                  googleDocUrl={docLinked ? docUrl : null}
                  activeDocLabel={activeDocLabel}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
