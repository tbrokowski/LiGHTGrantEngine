'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { grants, grantWriting, streamDraftGeneration } from '@/lib/api';

import {
  startGeneration,
  getInFlight,
  completeGeneration,
  failGeneration,
  isMarkedGenerating,
  setWatching,
  isBeingWatched,
} from '@/lib/skeletonGenerationStore';
import UnifiedWorkspace from './UnifiedWorkspace';
import AIChatPanel from './AIChatPanel';
import WorkspaceContext, { type SyncState, type WorkspaceCitation } from './WorkspaceContext';
import type { SkeletonSection } from './SkeletonEditor';
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
  const [selectedText, setSelectedText] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [wordCount, setWordCount] = useState(0);

  // ── Generation state ─────────────────────────────────────────────────────────
  const [generatingSkeleton, setGeneratingSkeleton] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftProgress, setDraftProgress] = useState<{ section: string; index: number; total: number } | null>(null);

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
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Exposed to UnifiedWorkspace so skeleton/draft generation can open the right panel
  const openPanelRef = useRef<((type: PanelTabType) => void) | null>(null);

  useEffect(() => { onGrantUpdateRef.current = onGrantUpdate; });
  useEffect(() => { docLinkedRef.current = docLinked; }, [docLinked]);

  // ── Skeleton generation helpers ──────────────────────────────────────────────
  const applySkeletonResult = useCallback((skeletonData: Record<string, unknown>) => {
    completeGeneration(grant.id);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setSkeleton(skeletonData);
    setGeneratingSkeleton(false);
    onGrantUpdateRef.current();
    // Auto-open the skeleton panel
    openPanelRef.current?.('skeleton');
  }, [grant.id]);

  const startPollingStatus = useCallback(() => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await grantWriting.status(grant.id);
        const d = res.data;
        if (d.writing_phase === 'skeleton' && d.proposal_skeleton && Object.keys(d.proposal_skeleton).length) {
          applySkeletonResult(d.proposal_skeleton as Record<string, unknown>);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }, [grant.id, applySkeletonResult]);

  // ── Mount effect ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    setWatching(grant.id, true);

    const inFlight = getInFlight(grant.id);
    if (inFlight) {
      setGeneratingSkeleton(true);
      inFlight.then((skeletonData) => {
        if (isMountedRef.current) applySkeletonResult(skeletonData);
      }).catch(() => {
        if (isMountedRef.current) setGeneratingSkeleton(false);
      });
    } else if (isMarkedGenerating(grant.id)) {
      setGeneratingSkeleton(true);
      startPollingStatus();
    } else {
      grantWriting.status(grant.id).then((res) => {
        const d = res.data;
        if (d.grant_idea) setGrantIdea(d.grant_idea);
        if (d.call_analysis && Object.keys(d.call_analysis).length) setCallAnalysis(d.call_analysis);
        if (d.call_requirements) setCallRequirements(d.call_requirements);
        if (d.proposal_skeleton && Object.keys(d.proposal_skeleton).length) setSkeleton(d.proposal_skeleton);
        if (d.last_review && Object.keys(d.last_review).length) setReviewReport(d.last_review);
      }).catch(() => {});
    }

    grantWriting.listCitations(grant.id).then((res) => setCitations(res.data)).catch(() => {});

    return () => {
      isMountedRef.current = false;
      setWatching(grant.id, false);
      if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
      if (googlePushTimer.current) { clearTimeout(googlePushTimer.current); googlePushTimer.current = null; }
    };
  }, [grant.id, applySkeletonResult, startPollingStatus]);

  // ── Auto-pull document changes from Google Doc every 8s ──────────────────────
  useEffect(() => {
    if (!docLinked) return;
    const interval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (autoSyncInProgress.current) return;
      if (docChangedSinceLastPush.current) return;
      try {
        const statusRes = await grants.getDocsRemoteStatus(grant.id);
        if (!statusRes.data.has_remote_changes) return;
        autoSyncInProgress.current = true;
        setSyncState('pulling');
        const pullRes = await grants.pullFromGoogleDoc(grant.id);
        setDocumentHtml(pullRes.data.content_html || '');
        setLastSynced(pullRes.data.last_synced);
        setSyncState('success');
        setTimeout(() => setSyncState((s) => s === 'success' ? 'idle' : s), 3000);
      } catch { /* silent fail */ } finally {
        autoSyncInProgress.current = false;
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [docLinked, grant.id]);

  // ── Callbacks ─────────────────────────────────────────────────────────────────
  const getDocumentContext = useCallback(
    () => documentHtml.replace(/<[^>]+>/g, ' ').trim(),
    [documentHtml]
  );

  const handleDocumentChange = useCallback((html: string, words: number, heads: string[]) => {
    setDocumentHtml(html);
    setWordCount(words);
    onHeadingsChange?.(heads);

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

  const handleGenerateSkeleton = async () => {
    setGeneratingSkeleton(true);
    try {
      await grantWriting.saveIdea(grant.id, { grant_idea: grantIdea, writing_phase: 'idea' });
    } catch {
      setGeneratingSkeleton(false);
      return;
    }

    const grantId = grant.id;
    const generationPromise = grantWriting.generateSkeleton(grantId)
      .then((res) => (res.data.proposal_skeleton || {}) as Record<string, unknown>);

    startGeneration(grantId, generationPromise);

    generationPromise.then((skeletonData) => {
      completeGeneration(grantId);
      if (isMountedRef.current) {
        setSkeleton(skeletonData);
        setGeneratingSkeleton(false);
        onGrantUpdateRef.current();
        openPanelRef.current?.('skeleton');
      } else if (!isBeingWatched(grantId)) {
        toast.success('Skeleton ready!', {
          description: 'Your grant proposal skeleton has been generated.',
          action: { label: 'View it', onClick: () => { window.location.href = `/grants/${grantId}/write`; } },
          duration: Infinity,
        });
      }
    }).catch((err) => {
      failGeneration(grantId);
      if (isMountedRef.current) setGeneratingSkeleton(false);
      console.error('Skeleton generation failed', err);
      toast.error('Skeleton generation failed. Please try again.');
    });
  };

  const handleSkeletonChange = async (updated: Record<string, unknown>) => {
    setSkeleton(updated);
    try {
      await grantWriting.updateSkeleton(grant.id, { proposal_skeleton: updated, writing_phase: 'skeleton' });
    } catch { /* ignore */ }
  };

  const handleGenerateDraft = () => {
    setGeneratingDraft(true);
    setDraftProgress(null);
    streamDraftGeneration(
      grant.id,
      (event) => {
        if (event.event === 'section_start' || event.event === 'section_complete') {
          setDraftProgress({ section: String(event.section), index: Number(event.index), total: Number(event.total) });
        }
        if (event.event === 'draft_complete' && event.document_html) {
          setDocumentHtml(String(event.document_html));
          openPanelRef.current?.('editor');
        }
      },
      () => {
        setGeneratingDraft(false);
        setDraftProgress(null);
        onGrantUpdate();
      },
      (err) => {
        console.error('Draft generation failed', err);
        setGeneratingDraft(false);
        setDraftProgress(null);
      },
    );
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
    generatingDraft,
    draftProgress,
    reviewReport,
    reviewLoading,
    citations,
    syncState,
    syncError,
    docLinked,
    docUrl,
    lastSynced,
    googleDocId: grant.google_doc_id ?? null,
    wordCount,
    onIdeaChange: handleIdeaChange,
    onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => {
      setCallAnalysis(analysis);
      if (requirements) setCallRequirements(requirements);
    },
    onGenerateSkeleton: handleGenerateSkeleton,
    onSkeletonChange: handleSkeletonChange,
    onGenerateDraft: handleGenerateDraft,
    onDocumentChange: handleDocumentChange,
    onSelectionChange: setSelectedText,
    onActiveSectionChange: setActiveSection,
    onInsertText: insertIntoSection,
    onDocLinked: (docId: string, url: string) => { setDocLinked(true); setDocUrl(url); onGrantUpdate(); },
    onDocPulled: (html: string) => { setDocumentHtml(html); openPanelRef.current?.('editor'); onGrantUpdate(); },
    onRunReview: handleRunReview,
    onCitationsUpdate: setCitations,
    onPushToDoc: handlePushToDoc,
    onPullFromDoc: handlePullFromDoc,
    getDocumentContext,
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
                  writingPhase="draft"
                  getDocumentContext={getDocumentContext}
                  onInsertText={insertIntoSection}
                  callRequirements={callRequirements}
                  useWritingStudio
                  googleDocUrl={docLinked ? docUrl : null}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
