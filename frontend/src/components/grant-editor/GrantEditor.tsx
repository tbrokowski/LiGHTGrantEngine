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
import IdeaPhase from './phases/IdeaPhase';
import SkeletonPhase from './phases/SkeletonPhase';
import DraftPhase from './phases/DraftPhase';
import type { SkeletonSection } from './SkeletonEditor';
import {
  CloudUpload, CloudDownload, Check, Loader2,
  AlertCircle, FileText, Lightbulb, LayoutList, PenLine,
} from 'lucide-react';

type WritingPhase = 'idea' | 'skeleton' | 'draft';

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

type SyncState = 'idle' | 'pushing' | 'pulling' | 'creating' | 'success' | 'error';

const PHASE_TABS: { id: WritingPhase; label: string; icon: React.ReactNode }[] = [
  { id: 'idea', label: 'Idea', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { id: 'skeleton', label: 'Skeleton', icon: <LayoutList className="w-3.5 h-3.5" /> },
  { id: 'draft', label: 'Draft & Review', icon: <PenLine className="w-3.5 h-3.5" /> },
];

export default function GrantEditor({ grant, onGrantUpdate, onHeadingsChange }: GrantEditorProps) {
  const [phase, setPhase] = useState<WritingPhase>((grant.writing_phase as WritingPhase) || 'idea');
  const [grantIdea, setGrantIdea] = useState(grant.grant_idea || '');
  const [callAnalysis, setCallAnalysis] = useState<Record<string, unknown>>(grant.call_analysis || {});
  const [skeleton, setSkeleton] = useState<Record<string, unknown>>(grant.proposal_skeleton || {});
  const [documentHtml, setDocumentHtml] = useState(grant.editor_document || '');
  const [callRequirements, setCallRequirements] = useState(grant.call_requirements || '');
  const [selectedText, setSelectedText] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<string[]>([]);

  const [generatingSkeleton, setGeneratingSkeleton] = useState(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // isMountedRef: true only while this specific component instance is mounted.
  const isMountedRef = useRef(false);
  // Stable ref to always call the latest onGrantUpdate without stale closure issues.
  const onGrantUpdateRef = useRef(onGrantUpdate);
  useEffect(() => { onGrantUpdateRef.current = onGrantUpdate; });

  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftProgress, setDraftProgress] = useState<{ section: string; index: number; total: number } | null>(null);

  const [reviewReport, setReviewReport] = useState<Record<string, unknown> | null>(grant.last_review || null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [citations, setCitations] = useState<Array<{ id?: string; formatted_citation?: string; source_type?: string; url?: string; claim_text?: string }>>([]);
  const [showReview, setShowReview] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [contextChips, setContextChips] = useState<string[]>([]);

  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [docLinked, setDocLinked] = useState(!!grant.google_doc_id);
  const [docUrl, setDocUrl] = useState(grant.google_doc_url || '');
  const [lastSynced, setLastSynced] = useState(grant.google_doc_last_synced || '');
  // Keep ref in sync with state for use inside timer callbacks
  useEffect(() => { docLinkedRef.current = docLinked; }, [docLinked]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ideaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 30-second debounced push to Google Doc after editor changes
  const googlePushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while an auto-sync operation is in progress (prevents concurrent runs)
  const autoSyncInProgress = useRef(false);
  // Track whether document content has changed since the last Google Doc push
  const docChangedSinceLastPush = useRef(false);
  // Stable ref to docLinked so timer callbacks always see the latest value
  const docLinkedRef = useRef(!!grant.google_doc_id);

  /**
   * Apply a resolved skeleton result to this component instance.
   * Clears generation tracking and switches the editor to the skeleton tab.
   */
  const applySkeletonResult = useCallback((skeletonData: Record<string, unknown>) => {
    completeGeneration(grant.id);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setSkeleton(skeletonData);
    setPhase('skeleton');
    setGeneratingSkeleton(false);
    onGrantUpdateRef.current();
  }, [grant.id]);

  /**
   * Poll /writing/status every 3 s until writing_phase === 'skeleton'.
   * Used as a fallback when the page was refreshed mid-generation (original
   * HTTP request was killed) or when the component remounted while in-flight.
   */
  const startPollingStatus = useCallback(() => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await grantWriting.status(grant.id);
        const d = res.data;
        if (d.writing_phase === 'skeleton' && d.proposal_skeleton && Object.keys(d.proposal_skeleton).length) {
          applySkeletonResult(d.proposal_skeleton as Record<string, unknown>);
        }
      } catch {
        // Keep polling through transient errors
      }
    }, 3000);
  }, [grant.id, applySkeletonResult]);

  useEffect(() => {
    isMountedRef.current = true;
    setWatching(grant.id, true);

    const inFlight = getInFlight(grant.id);
    if (inFlight) {
      // A generation is still in-flight from a previous visit during this session.
      // Show the spinner and attach a handler so we update state when it resolves.
      setGeneratingSkeleton(true);
      inFlight.then((skeletonData) => {
        if (isMountedRef.current) {
          applySkeletonResult(skeletonData);
        }
      }).catch(() => {
        if (isMountedRef.current) setGeneratingSkeleton(false);
      });
    } else if (isMarkedGenerating(grant.id)) {
      // The page was refreshed while generation was in-progress — fall back to polling.
      setGeneratingSkeleton(true);
      startPollingStatus();
    } else {
      // Normal mount: sync from server to pick up collaborator changes.
      grantWriting.status(grant.id).then((res) => {
        const d = res.data;
        if (d.grant_idea) setGrantIdea(d.grant_idea);
        if (d.call_analysis && Object.keys(d.call_analysis).length) setCallAnalysis(d.call_analysis);
        if (d.call_requirements) setCallRequirements(d.call_requirements);
        if (d.proposal_skeleton && Object.keys(d.proposal_skeleton).length) setSkeleton(d.proposal_skeleton);
        if (d.last_review && Object.keys(d.last_review).length) setReviewReport(d.last_review);
        if (d.writing_phase) setPhase(d.writing_phase as WritingPhase);
      }).catch(() => {});
    }

    grantWriting.listCitations(grant.id).then((res) => setCitations(res.data)).catch(() => {});

    return () => {
      isMountedRef.current = false;
      setWatching(grant.id, false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (googlePushTimer.current) {
        clearTimeout(googlePushTimer.current);
        googlePushTimer.current = null;
      }
    };
  }, [grant.id, applySkeletonResult, startPollingStatus]);

  // Auto-pull interval: every 30s, check if the Google Doc has been modified
  // externally and pull it into the editor (Google Doc is the source of truth).
  useEffect(() => {
    if (!docLinked) return;
    const interval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (autoSyncInProgress.current) return;
      // Skip if the user just edited (push timer is pending — our version is newer)
      if (docChangedSinceLastPush.current) return;
      try {
        const statusRes = await grants.getDocsRemoteStatus(grant.id);
        if (!statusRes.data.has_remote_changes) return;
        autoSyncInProgress.current = true;
        const pullRes = await grants.pullFromGoogleDoc(grant.id);
        setDocumentHtml(pullRes.data.content_html || '');
        setLastSynced(pullRes.data.last_synced);
        setSyncState('success');
        setTimeout(() => setSyncState((s) => s === 'success' ? 'idle' : s), 3000);
      } catch {
        // Silent fail — manual pull always available
      } finally {
        autoSyncInProgress.current = false;
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [docLinked, grant.id]);

  const getDocumentContext = useCallback(() => documentHtml.replace(/<[^>]+>/g, ' ').trim(), [documentHtml]);

  const handleDocumentChange = useCallback((html: string, words: number, heads: string[]) => {
    setDocumentHtml(html);
    setWordCount(words);
    setHeadings(heads);
    onHeadingsChange?.(heads);

    // Auto-save to DB (1.5s debounce)
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await grants.saveDocument(grant.id, html, true);
      } catch (e) {
        console.error('Auto-save failed', e);
      }
    }, 1500);

    // Mark that content has changed since last push, then schedule a push
    // to Google Doc 30s after the last keystroke (only if a doc is linked).
    docChangedSinceLastPush.current = true;
    if (googlePushTimer.current) clearTimeout(googlePushTimer.current);
    googlePushTimer.current = setTimeout(async () => {
      if (!docChangedSinceLastPush.current) return;
      if (autoSyncInProgress.current) return;
      if (!docLinkedRef.current) return;
      autoSyncInProgress.current = true;
      docChangedSinceLastPush.current = false;
      try {
        // Save first so the push uses the latest content
        await grants.saveDocument(grant.id, html, false);
        const res = await grants.pushToGoogleDoc(grant.id);
        setLastSynced(res.data.last_synced);
        setSyncState('success');
        setTimeout(() => setSyncState((s) => s === 'success' ? 'idle' : s), 3000);
      } catch {
        // Silent fail for auto-push — user can always push manually
      } finally {
        autoSyncInProgress.current = false;
      }
    }, 30000);
  }, [grant.id, onHeadingsChange]);

  const handlePhaseChange = (newPhase: WritingPhase) => {
    setPhase(newPhase);
    // Persist the active phase so all collaborators land on the same tab on reload
    grantWriting.saveIdea(grant.id, { grant_idea: grantIdea, writing_phase: newPhase })
      .catch(() => {});
  };

  const handleIdeaChange = (idea: string) => {
    setGrantIdea(idea);
    if (ideaTimer.current) clearTimeout(ideaTimer.current);
    ideaTimer.current = setTimeout(async () => {
      try {
        await grantWriting.saveIdea(grant.id, { grant_idea: idea, writing_phase: phase });
      } catch { /* ignore */ }
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

    // Fire the generation request. Do NOT await — the user can navigate away freely.
    // The axios request continues running in the background; the result is persisted to the DB.
    const grantId = grant.id;
    const generationPromise = grantWriting.generateSkeleton(grantId)
      .then((res) => (res.data.proposal_skeleton || {}) as Record<string, unknown>);

    startGeneration(grantId, generationPromise);

    generationPromise.then((skeletonData) => {
      completeGeneration(grantId);
      if (isMountedRef.current) {
        // The user stayed on the page — update state directly.
        setSkeleton(skeletonData);
        setPhase('skeleton');
        setGeneratingSkeleton(false);
        onGrantUpdateRef.current();
      } else if (!isBeingWatched(grantId)) {
        // The user navigated away and hasn't returned — show a persistent toast.
        toast.success('Skeleton ready!', {
          description: 'Your grant proposal skeleton has been generated.',
          action: {
            label: 'View it',
            onClick: () => { window.location.href = `/grants/${grantId}/write`; },
          },
          duration: Infinity,
        });
      }
      // else: user navigated away and returned — the init useEffect's inFlight handler
      // will apply the result when it detects the resolved promise.
    }).catch((err) => {
      failGeneration(grantId);
      if (isMountedRef.current) {
        setGeneratingSkeleton(false);
      }
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
        if (event.event === 'section_start') {
          setDraftProgress({
            section: String(event.section),
            index: Number(event.index),
            total: Number(event.total),
          });
        }
        if (event.event === 'section_complete') {
          setDraftProgress({
            section: String(event.section),
            index: Number(event.index),
            total: Number(event.total),
          });
        }
        if (event.event === 'draft_complete' && event.document_html) {
          setDocumentHtml(String(event.document_html));
          setPhase('draft');
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
      setShowReview(true);
    } finally {
      setReviewLoading(false);
    }
  };

  const insertIntoSection = (text: string) => {
    if (!activeSection) {
      setDocumentHtml((prev) => prev + `<p>${text}</p>`);
      return;
    }
    const regex = new RegExp(`(<h2[^>]*>${activeSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>)([\\s\\S]*?)(?=<h2|$)`, 'i');
    const match = documentHtml.match(regex);
    if (match) {
      const updated = documentHtml.replace(regex, `$1\n<p>${text}</p>$2`);
      setDocumentHtml(updated);
    } else {
      setDocumentHtml((prev) => prev + `<p>${text}</p>`);
    }
  };

  const extractError = (e: unknown): string => {
    const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    return detail || (e as { message?: string }).message || 'An unexpected error occurred';
  };

  const handlePush = async () => {
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

  const handlePull = async () => {
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

  const syncBusy = syncState === 'pushing' || syncState === 'pulling';

  useEffect(() => {
    const chips: string[] = [];
    if (callAnalysis && Object.keys(callAnalysis).length) chips.push('Call req');
    if (activeSection) chips.push(activeSection);
    if (grant.style_profile && Object.keys(grant.style_profile).length) chips.push('Style profile');
    setContextChips(chips);
  }, [callAnalysis, activeSection, grant.style_profile]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Phase navigation + toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1">
          {PHASE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handlePhaseChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                phase === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{wordCount.toLocaleString()} words</span>
          {phase === 'draft' && docLinked && (
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1">
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              <a href={docUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Google Doc
              </a>
              <button onClick={handlePush} disabled={syncBusy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
                {syncState === 'pushing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CloudUpload className="w-3 h-3" />}
              </button>
              <button onClick={handlePull} disabled={syncBusy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
                {syncState === 'pulling' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CloudDownload className="w-3 h-3" />}
              </button>
              {syncState === 'success' && <Check className="w-3.5 h-3.5 text-green-500" />}
            </div>
          )}
        </div>
      </div>

      {syncState === 'error' && syncError && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-600">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {syncError}
          <button onClick={() => { setSyncState('idle'); setSyncError(''); }} className="ml-auto">×</button>
        </div>
      )}

      {/* Phase content */}
      <div className="flex-1 overflow-hidden flex">
        {phase === 'idea' && (
          <IdeaPhase
            grantId={grant.id}
            grantIdea={grantIdea}
            callAnalysis={callAnalysis}
            onIdeaChange={handleIdeaChange}
            onCallAnalysis={(analysis, requirements) => {
              setCallAnalysis(analysis);
              if (requirements) setCallRequirements(requirements);
            }}
            onGenerateSkeleton={handleGenerateSkeleton}
            generating={generatingSkeleton}
            googleDocId={grant.google_doc_id}
            googleDocUrl={docUrl || grant.google_doc_url}
            googleDocLastSynced={lastSynced || grant.google_doc_last_synced}
            onDocLinked={(id, url) => {
              setDocLinked(true);
              setDocUrl(url);
              onGrantUpdate();
            }}
            onDocPulled={(html) => {
              setDocumentHtml(html);
              handlePhaseChange('draft');
              onGrantUpdate();
            }}
          />
        )}

        {phase === 'skeleton' && (
          <SkeletonPhase
            skeleton={skeleton as { sections?: SkeletonSection[]; title_suggestion?: string; narrative_arc?: string; key_messages?: string[] }}
            onSkeletonChange={handleSkeletonChange}
            onGenerateDraft={handleGenerateDraft}
            generating={generatingDraft}
            draftProgress={draftProgress}
          />
        )}

        {phase === 'draft' && (
          <DraftPhase
            grantId={grant.id}
            documentHtml={documentHtml}
            callRequirements={callRequirements}
            selectedText={selectedText}
            activeSection={activeSection}
            contextChips={contextChips}
            reviewReport={reviewReport}
            reviewLoading={reviewLoading}
            citations={citations}
            showReview={showReview}
            showCitations={showCitations}
            googleDocUrl={grant.google_doc_url}
            onDocumentChange={handleDocumentChange}
            onSelectionChange={setSelectedText}
            onActiveSectionChange={setActiveSection}
            onRunReview={handleRunReview}
            onCitationsUpdate={setCitations}
            onInsertText={insertIntoSection}
            getDocumentContext={getDocumentContext}
            onToggleReview={() => setShowReview(!showReview)}
            onToggleCitations={() => setShowCitations(!showCitations)}
          />
        )}
      </div>
    </div>
  );
}
