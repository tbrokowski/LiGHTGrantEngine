'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { AlertCircle, AlertTriangle, MessageCircle, Quote, Sparkles, X } from 'lucide-react';
import { grants, grantWriting } from '@/lib/api';
import {
  isMarkedAnalyzing,
  type CallAnalysisStatus,
  type AIThinkingStepData,
  isDraftGenerating,
  startDraftGeneration,
  completeDraftGeneration,
  resetDraftGeneration,
  pollDraftUntilDone,
} from '@/lib/callAnalysisStore';
import {
  formatInlineCitation,
  formatMlaCitation,
  insertParagraphIntoSection,
  ensureBibliographyAndAppend,
  type InsertableCitation,
} from '@/lib/citationFormat';
import ProposalInputs, { PROPOSAL_TYPES, type ProposalType } from './ProposalInputs';
import SingleDocEditor from './SingleDocEditor';
import GoogleDocsControl, { type SyncState } from './GoogleDocsControl';
import AIChatPanel from './AIChatPanel';
import CitationsPanel from './CitationsPanel';
import CommentsPanel from './CommentsPanel';
import ArchiveSourcePane from './ArchiveSourcePane';
import type { CommentBridge } from './editor-extensions';

interface GrantDetail {
  id: string;
  title: string;
  funder: string | null;
  call_requirements: string | null;
  editor_document?: string | null;
  google_doc_id?: string | null;
  google_doc_url?: string | null;
  google_doc_last_synced?: string | null;
  grant_idea?: string | null;
  call_analysis?: Record<string, unknown>;
  call_intelligence?: Record<string, unknown> | null;
  style_profile?: Record<string, unknown> | null;
}

interface GrantEditorProps {
  grant: GrantDetail;
  onGrantUpdate: () => void;
  onHeadingsChange?: (headings: string[]) => void;
}

type Citation = InsertableCitation & { claim_text?: string };
type ArchiveSourceMeta = { sectionId: string; archiveId?: string; grantTitle?: string; sectionType?: string };
type SidebarTab = 'assistant' | 'citations' | 'comments' | 'source';

function readProposalType(styleProfile?: Record<string, unknown> | null): ProposalType | null {
  const v = styleProfile?.proposal_type;
  return PROPOSAL_TYPES.some((t) => t.value === v) ? (v as ProposalType) : null;
}

function errorMessage(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
  return detail || (e as { message?: string }).message || 'An unexpected error occurred';
}

/**
 * The proposal editor: one page. The inputs (blurb, call document, proposal
 * type) sit at the top; below them is the single document where the proposal is
 * generated and edited. Assistant, citations and comments open in a side panel.
 */
export default function GrantEditor({ grant, onGrantUpdate, onHeadingsChange }: GrantEditorProps) {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  const [grantIdea, setGrantIdea] = useState(grant.grant_idea || '');
  const [proposalType, setProposalType] = useState<ProposalType>(readProposalType(grant.style_profile) ?? 'horizon');
  const [callAnalysis, setCallAnalysis] = useState<Record<string, unknown>>(grant.call_analysis || {});
  const [callIntelligence, setCallIntelligence] = useState<Record<string, unknown>>(grant.call_intelligence || {});
  const [callRequirements, setCallRequirements] = useState(grant.call_requirements || '');
  const [callAnalysisStatus, setCallAnalysisStatus] = useState<CallAnalysisStatus>('idle');

  // ── Document ────────────────────────────────────────────────────────────────
  const [documentHtml, setDocumentHtml] = useState(grant.editor_document || '');
  const [selectedText, setSelectedText] = useState('');
  const [activeSection, setActiveSection] = useState('');

  // ── Generation ──────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [draftSteps, setDraftSteps] = useState<AIThinkingStepData[] | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  // ── Side panel ──────────────────────────────────────────────────────────────
  const [sidebar, setSidebar] = useState<SidebarTab | null>(null);
  const [sourceMeta, setSourceMeta] = useState<ArchiveSourceMeta | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 340;
    return parseInt(localStorage.getItem(`aiSidebarWidth:${grant.id}`) || '340');
  });
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const commentBridge = useRef<CommentBridge>({});

  // ── Google Docs sync ────────────────────────────────────────────────────────
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState('');
  const [docLinked, setDocLinked] = useState(!!grant.google_doc_id);
  const [docUrl, setDocUrl] = useState(grant.google_doc_url || '');
  const [remoteChangePending, setRemoteChangePending] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ideaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const googlePushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSyncInProgress = useRef(false);
  const docChangedSinceLastPush = useRef(false);
  const docLinkedRef = useRef(!!grant.google_doc_id);
  const isMountedRef = useRef(false);
  const onGrantUpdateRef = useRef(onGrantUpdate);

  useEffect(() => { onGrantUpdateRef.current = onGrantUpdate; });
  useEffect(() => { docLinkedRef.current = docLinked; }, [docLinked]);

  // ── Draft generation ────────────────────────────────────────────────────────
  const runDraftPoll = useCallback(async () => {
    try {
      const data = await pollDraftUntilDone(grant.id, (progress) => {
        if (progress.draft_steps?.length) setDraftSteps(progress.draft_steps);
      });
      completeDraftGeneration(grant.id);
      if (data.editor_document) setDocumentHtml(data.editor_document);
      onGrantUpdateRef.current();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Proposal generation failed.';
      setDraftError(msg);
      resetDraftGeneration(grant.id);
      toast.error(msg);
    } finally {
      if (isMountedRef.current) {
        setGenerating(false);
        setDraftSteps(null);
      }
    }
  }, [grant.id]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setDraftSteps(null);
    setDraftError(null);
    try {
      if (ideaTimer.current) clearTimeout(ideaTimer.current);
      await grantWriting.saveIdea(grant.id, { grant_idea: grantIdea, proposal_type: proposalType });
      // replan: build the structure fresh from the current inputs and proposal type.
      await grantWriting.enqueueDraft(grant.id, { replan: true });
      startDraftGeneration(grant.id);
      runDraftPoll();
    } catch (err) {
      toast.error(`Couldn't start generation: ${errorMessage(err)}`);
      resetDraftGeneration(grant.id);
      setGenerating(false);
    }
  };

  // ── Mount: load writing state, resume a running generation ──────────────────
  useEffect(() => {
    isMountedRef.current = true;

    grantWriting.status(grant.id).then((res) => {
      const d = res.data;
      if (d.grant_idea) setGrantIdea(d.grant_idea as string);
      const savedType = readProposalType(d.style_profile as Record<string, unknown> | undefined);
      if (savedType) setProposalType(savedType);
      if (d.call_analysis && Object.keys(d.call_analysis as object).length) setCallAnalysis(d.call_analysis as Record<string, unknown>);
      if (d.call_requirements) setCallRequirements(d.call_requirements as string);
      if (d.call_analysis_status) setCallAnalysisStatus(d.call_analysis_status as CallAnalysisStatus);
      if (d.call_intelligence && Object.keys(d.call_intelligence as object).length) {
        setCallIntelligence(d.call_intelligence as Record<string, unknown>);
      }
      if (d.editor_document) setDocumentHtml(d.editor_document as string);
      if (d.draft_status === 'running' || isDraftGenerating(grant.id)) {
        setGenerating(true);
        runDraftPoll();
      }
    }).catch(() => {});

    grantWriting.listCitations(grant.id).then((res) => setCitations(res.data)).catch(() => {});

    return () => {
      isMountedRef.current = false;
      if (googlePushTimer.current) { clearTimeout(googlePushTimer.current); googlePushTimer.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.id]);

  // ── Google Docs: poll every 15s ─────────────────────────────────────────────
  // Remote changed + local clean → pull silently. Both changed → conflict banner.
  useEffect(() => {
    if (!docLinked) return;
    const interval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (autoSyncInProgress.current) return;
      try {
        const statusRes = await grants.getDocsRemoteStatus(grant.id);
        if (!statusRes.data.has_remote_changes) return;
        if (!docChangedSinceLastPush.current) {
          autoSyncInProgress.current = true;
          setSyncState('pulling');
          const pullRes = await grants.pullFromGoogleDoc(grant.id);
          setDocumentHtml(pullRes.data.content_html || '');
          setRemoteChangePending(false);
          setSyncState('success');
          setTimeout(() => setSyncState((s) => s === 'success' ? 'idle' : s), 3000);
        } else {
          setRemoteChangePending(true);
        }
      } catch { /* silent */ } finally {
        autoSyncInProgress.current = false;
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [docLinked, grant.id]);

  // ── Input handlers ──────────────────────────────────────────────────────────
  const handleIdeaChange = (idea: string) => {
    setGrantIdea(idea);
    if (ideaTimer.current) clearTimeout(ideaTimer.current);
    ideaTimer.current = setTimeout(() => {
      grantWriting.saveIdea(grant.id, { grant_idea: idea }).catch(() => {});
    }, 1000);
  };

  const handleProposalTypeChange = (type: ProposalType) => {
    setProposalType(type);
    grantWriting.saveIdea(grant.id, { grant_idea: grantIdea, proposal_type: type }).catch(() => {
      toast.error('Could not save the proposal type.');
    });
  };

  const handleCallAnalysis = useCallback((analysis: Record<string, unknown>, requirements?: string) => {
    if (Object.keys(analysis).length) setCallAnalysis(analysis);
    if (requirements) setCallRequirements(requirements);
  }, []);

  // ── Document handlers ───────────────────────────────────────────────────────
  const handleDocumentChange = useCallback((html: string, _words: number, heads: string[]) => {
    setDocumentHtml(html);
    onHeadingsChange?.(heads);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await grants.saveDocument(grant.id, html, true); }
      catch (e) { console.error('Auto-save failed', e); }
    }, 1500);

    docChangedSinceLastPush.current = true;
    if (googlePushTimer.current) clearTimeout(googlePushTimer.current);
    googlePushTimer.current = setTimeout(async () => {
      if (!docChangedSinceLastPush.current || autoSyncInProgress.current || !docLinkedRef.current) return;
      autoSyncInProgress.current = true;
      docChangedSinceLastPush.current = false;
      setSyncState('pushing');
      try {
        await grants.saveDocument(grant.id, html, false);
        await grants.pushToGoogleDoc(grant.id);
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

  const insertIntoSection = (text: string) => {
    setDocumentHtml((prev) => insertParagraphIntoSection(prev, activeSection, `<p>${text}</p>`));
  };

  const handleInsertCitation = (citation: Citation) => {
    const mla = formatMlaCitation(citation);
    const dedupeKey = citation.id || citation.url || mla.slice(0, 60);
    setDocumentHtml((prev) => {
      const withInline = insertParagraphIntoSection(prev, activeSection, `<p>${formatInlineCitation(citation)}</p>`);
      return ensureBibliographyAndAppend(withInline, mla, dedupeKey);
    });
  };

  const getDocumentContext = useCallback(
    () => documentHtml.replace(/<[^>]+>/g, ' ').trim() || grantIdea,
    [documentHtml, grantIdea],
  );

  // ── Google Docs actions ─────────────────────────────────────────────────────
  const handlePushToDoc = async () => {
    setSyncState('pushing');
    setSyncError('');
    try {
      await grants.saveDocument(grant.id, documentHtml, false);
      await grants.pushToGoogleDoc(grant.id);
      setSyncState('success');
      setTimeout(() => setSyncState('idle'), 3000);
    } catch (e: unknown) {
      setSyncError(errorMessage(e));
      setSyncState('error');
    }
  };

  const handlePullFromDoc = async () => {
    setSyncState('pulling');
    setSyncError('');
    try {
      const res = await grants.pullFromGoogleDoc(grant.id);
      setDocumentHtml(res.data.content_html);
      setRemoteChangePending(false);
      setSyncState('success');
      onGrantUpdate();
      setTimeout(() => setSyncState('idle'), 3000);
    } catch (e: unknown) {
      setSyncError(errorMessage(e));
      setSyncState('error');
    }
  };

  // ── Side panel ──────────────────────────────────────────────────────────────
  const toggleSidebar = (tab: SidebarTab) => setSidebar((cur) => (cur === tab ? null : tab));

  const openArchiveSource = (meta: ArchiveSourceMeta) => {
    setSourceMeta(meta);
    setSidebar('source');
  };

  const handleSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const next = Math.max(260, Math.min(600, sidebarDragRef.current.startWidth + sidebarDragRef.current.startX - ev.clientX));
      setSidebarWidth(next);
      localStorage.setItem(`aiSidebarWidth:${grant.id}`, String(next));
    };
    const onUp = () => {
      sidebarDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const sidebarButton = (tab: SidebarTab, title: string, Icon: typeof Sparkles) => (
    <button
      onClick={() => toggleSidebar(tab)}
      title={sidebar === tab ? `Hide ${title}` : `Show ${title}`}
      className="p-1.5 rounded-[var(--radius-sm)] transition-colors"
      style={{
        background: sidebar === tab ? 'var(--accent-secondary)' : 'transparent',
        color: sidebar === tab ? 'var(--ink-primary)' : 'var(--ink-muted)',
      }}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2"
        style={{ background: 'var(--surface-raised)', borderBottom: '1px solid var(--rule-subtle)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-semibold truncate max-w-[260px]" style={{ color: 'var(--ink-primary)' }} title={grant.title}>
            {grant.title}
          </h1>
          {grant.funder && (
            <span className="text-xs truncate max-w-[160px]" style={{ color: 'var(--ink-muted)' }}>{grant.funder}</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <GoogleDocsControl
            grantId={grant.id}
            docLinked={docLinked}
            docUrl={docUrl}
            syncState={syncState}
            onDocLinked={(_id, url) => { setDocLinked(true); setDocUrl(url); onGrantUpdate(); }}
            onUnlink={() => { setDocLinked(false); setDocUrl(''); onGrantUpdate(); }}
            onPushToDoc={handlePushToDoc}
            onPullFromDoc={handlePullFromDoc}
          />
          <div className="flex items-center gap-1">
            {sidebarButton('comments', 'Comments', MessageCircle)}
            {sidebarButton('citations', 'Citations', Quote)}
            {sidebarButton('assistant', 'AI Assistant', Sparkles)}
          </div>
        </div>
      </div>

      {remoteChangePending && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 text-xs"
          style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)', borderBottom: '1px solid var(--rule-subtle)' }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          The Google Doc changed too — your local edits are kept.
          <button onClick={handlePullFromDoc} className="ml-auto underline">Pull & overwrite</button>
          <button onClick={() => setRemoteChangePending(false)}>Dismiss</button>
        </div>
      )}
      {syncState === 'error' && syncError && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 text-xs"
          style={{ background: 'var(--state-danger-bg)', color: 'var(--state-danger)', borderBottom: '1px solid var(--rule-subtle)' }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {syncError}
          <button onClick={() => { setSyncState('idle'); setSyncError(''); }} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ── Page: inputs, then the document ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto grant-editor-scroll">
          <div className="max-w-[880px] mx-auto px-6 py-6 space-y-6">
            <ProposalInputs
              grantId={grant.id}
              grantIdea={grantIdea}
              onIdeaChange={handleIdeaChange}
              proposalType={proposalType}
              onProposalTypeChange={handleProposalTypeChange}
              callAnalysis={callAnalysis}
              callRequirements={callRequirements}
              callIntelligence={callIntelligence}
              callAnalysisStatus={callAnalysisStatus}
              onCallAnalysis={handleCallAnalysis}
              onCallAnalysisStatusChange={setCallAnalysisStatus}
              resumeCallAnalysis={callAnalysisStatus === 'running' || isMarkedAnalyzing(grant.id)}
              generating={generating}
              draftSteps={draftSteps}
              draftError={draftError}
              hasDocument={!!documentHtml.replace(/<[^>]+>/g, '').trim()}
              onGenerate={handleGenerate}
            />
            <SingleDocEditor
              documentHtml={documentHtml}
              onDocumentChange={handleDocumentChange}
              onSelectionChange={setSelectedText}
              onActiveSectionChange={setActiveSection}
              grantId={grant.id}
              onEditorApi={(apiRef) => { commentBridge.current.editor = apiRef; }}
              onAnchorClick={(id) => { setSidebar('comments'); commentBridge.current.focusCard?.(id); }}
            />
          </div>
        </div>

        {sidebar && (
          <div className="flex flex-shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
            <div
              onMouseDown={handleSidebarResize}
              className="w-1 flex-shrink-0 cursor-col-resize select-none"
              style={{ background: 'var(--rule-subtle)' }}
              title="Drag to resize"
            />
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ background: 'var(--surface-panel)' }}>
              {sidebar === 'assistant' && (
                <AIChatPanel
                  grantId={grant.id}
                  selectedText={selectedText}
                  activeSection={activeSection}
                  writingPhase={documentHtml ? 'editor' : 'idea'}
                  getDocumentContext={getDocumentContext}
                  onInsertText={insertIntoSection}
                  callRequirements={callRequirements}
                  useWritingStudio
                  googleDocUrl={docLinked ? docUrl : null}
                  activeDocLabel="Draft"
                  onOpenArchiveSection={openArchiveSource}
                />
              )}
              {sidebar === 'citations' && (
                <CitationsPanel
                  grantId={grant.id}
                  citations={citations}
                  onCitationsUpdate={setCitations}
                  activeSection={activeSection}
                  onInsertCitation={handleInsertCitation}
                  onOpenArchiveSection={openArchiveSource}
                />
              )}
              {sidebar === 'comments' && (
                <CommentsPanel
                  grantId={grant.id}
                  documentId="draft"
                  onClose={() => setSidebar(null)}
                  bridge={commentBridge}
                  selectedText={selectedText}
                  onSelectionChange={setSelectedText}
                />
              )}
              {sidebar === 'source' && sourceMeta && (
                <>
                  <div className="flex items-center justify-between px-3 py-2 text-xs"
                    style={{ borderBottom: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
                    <span className="truncate">
                      {sourceMeta.grantTitle || 'Archive source'}{sourceMeta.sectionType ? ` — ${sourceMeta.sectionType}` : ''}
                    </span>
                    <button onClick={() => setSidebar(null)} title="Close"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <ArchiveSourcePane key={sourceMeta.sectionId} sectionId={sourceMeta.sectionId} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
