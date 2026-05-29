'use client';

import { useRef, useState, useCallback, useEffect, DragEvent } from 'react';
import {
  Upload, Mic, MicOff, Loader2, Sparkles, CheckCircle2, ChevronDown,
  ExternalLink, Link2, PlusCircle, CloudUpload, CloudDownload, RefreshCw, X,
} from 'lucide-react';
import { grantWriting, grants as grantsApi } from '@/lib/api';
import {
  runCallAnalysisJob,
  formatAnalysisError,
  isMarkedAnalyzing,
  resetAnalysis,
  type CallAnalysisStatus,
  type AIThinkingStepData,
} from '@/lib/callAnalysisStore';
import CallRequirementsPanel from '../CallRequirementsPanel';
import AIThinkingLog from '../AIThinkingLog';

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

type SpeechRecognitionCtor = new () => ISpeechRecognition;

interface UploadedCallDoc {
  document_id: string;
  file_name: string;
  file_url: string;
  uploaded_at?: string;
}

export interface SectionConstraint {
  name: string;
  word_limit?: number | null;
  page_limit?: string | null;
  priority?: string;
  order?: number;
}

export interface SkeletonConstraints {
  section_constraints: SectionConstraint[];
  total_word_limit?: number | null;
  total_page_limit?: string | null;
}

interface IdeaPhaseProps {
  grantId: string;
  grantIdea: string;
  callAnalysis: Record<string, unknown>;
  callRequirementsText?: string;
  callAnalysisStatus?: CallAnalysisStatus;
  onCallAnalysisStatusChange?: (status: CallAnalysisStatus, error?: string | null) => void;
  resumeCallAnalysis?: boolean;
  stylePreview?: Array<Record<string, unknown>>;
  onIdeaChange: (idea: string) => void;
  onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => void;
  onGenerateSkeleton: (constraints?: SkeletonConstraints) => void;
  generating: boolean;
  skeletonSteps?: AIThinkingStepData[] | null;
  skeletonError?: string | null;
  googleDocId?: string | null;
  googleDocUrl?: string | null;
  googleDocLastSynced?: string | null;
  onDocLinked?: (docId: string, docUrl: string) => void;
  onDocPulled?: (html: string) => void;
  onSelectionChange?: (text: string) => void;
  callIntelligence?: Record<string, unknown>;
}

// Collapsible section wrapper
function CollapsibleSection({
  label,
  expanded,
  onToggle,
  summary,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 w-full text-left"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`}
        />
        <span className="text-sm font-semibold text-gray-500">{label}</span>
        {!expanded && summary && (
          <span className="ml-1.5 text-sm font-normal text-gray-400 truncate flex-1">{summary}</span>
        )}
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}

export default function IdeaPhase({
  grantId,
  grantIdea,
  callAnalysis,
  callRequirementsText = '',
  callAnalysisStatus = 'idle',
  onCallAnalysisStatusChange,
  resumeCallAnalysis = false,
  onIdeaChange,
  onCallAnalysis,
  onGenerateSkeleton,
  generating,
  skeletonSteps,
  skeletonError,
  googleDocId,
  googleDocUrl,
  googleDocLastSynced,
  onDocLinked,
  onDocPulled,
  onSelectionChange,
  callIntelligence,
}: IdeaPhaseProps) {
  // Drag-and-drop state for section constraints table
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Panel expand state
  const [ideaExpanded, setIdeaExpanded] = useState(true);
  const [docExpanded, setDocExpanded] = useState(true);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [intelligenceExpanded, setIntelligenceExpanded] = useState(true);
  const [constraintsExpanded, setConstraintsExpanded] = useState(true);

  // Proposal constraints (pre-generation)
  const [totalWordLimit, setTotalWordLimit] = useState<string>('');
  const [totalPageLimit, setTotalPageLimit] = useState<string>('');
  const [sectionConstraints, setSectionConstraints] = useState<SectionConstraint[]>([]);

  // Initialise constraints from call_analysis when it becomes available
  useEffect(() => {
    const sectionReqs = (callAnalysis as Record<string, Record<string, unknown>>).section_requirements;
    if (sectionReqs && typeof sectionReqs === 'object') {
      const sections: SectionConstraint[] = Object.entries(sectionReqs)
        .filter(([, d]) => typeof d === 'object' && d !== null)
        .map(([name, d], i) => ({
          name,
          word_limit: (d as Record<string, unknown>).word_limit as number | null ?? null,
          page_limit: (d as Record<string, unknown>).page_limit as string | null ?? null,
          priority: (d as Record<string, unknown>).priority as string ?? 'medium',
          order: i + 1,
        }));
      setSectionConstraints(sections);
    }
    const wl = (callAnalysis as Record<string, unknown>).word_limit;
    if (wl) setTotalWordLimit(String(wl));
    const pl = (callAnalysis as Record<string, unknown>).page_limit;
    if (pl) setTotalPageLimit(String(pl));
  // Only seed once when analysis is first populated
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callAnalysis]);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedCallDoc | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSoftTimeout, setAnalysisSoftTimeout] = useState(false);
  const [callAnalysisSteps, setCallAnalysisSteps] = useState<AIThinkingStepData[] | undefined>(undefined);

  // Voice state
  const [listening, setListening] = useState(false);

  // Google Docs state
  const [docLinkInput, setDocLinkInput] = useState('');
  const [showDocLinkInput, setShowDocLinkInput] = useState(false);
  const [docSyncState, setDocSyncState] = useState<'idle' | 'linking' | 'creating' | 'pushing' | 'pulling' | 'error'>('idle');
  const [docSyncError, setDocSyncError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const resumePollStarted = useRef(false);

  const isAnalyzing = reanalyzing || uploading || callAnalysisStatus === 'running';

  const hasExistingAnalysis =
    (callAnalysis && Object.keys(callAnalysis).length > 0) ||
    !!callRequirementsText?.trim() ||
    callAnalysisStatus === 'running' ||
    callAnalysisStatus === 'failed';

  const docLinked = !!googleDocId;
  const docSyncBusy = ['linking', 'creating', 'pushing', 'pulling'].includes(docSyncState);

  const applyAnalysisResult = useCallback(
    (data: { call_analysis?: Record<string, unknown>; call_requirements?: string }) => {
      if (data.call_analysis && Object.keys(data.call_analysis).length > 0) {
        onCallAnalysis(data.call_analysis, data.call_requirements);
      } else if (data.call_requirements) {
        onCallAnalysis({}, data.call_requirements);
      }
      onCallAnalysisStatusChange?.('completed', null);
      setAnalysisError(null);
    },
    [onCallAnalysis, onCallAnalysisStatusChange],
  );

  const runAnalysis = useCallback(
    async (trigger: () => Promise<unknown>, opts?: { afterUpload?: (data: Record<string, unknown>) => void }) => {
      setAnalysisError(null);
      setAnalysisSoftTimeout(false);
      setCallAnalysisSteps(undefined);
      setIntelligenceExpanded(true);
      onCallAnalysisStatusChange?.('running', null);
      setReanalyzing(true);
      try {
        const data = await runCallAnalysisJob(grantId, trigger, (progress) => {
          if (progress.call_analysis_status === 'running') {
            onCallAnalysisStatusChange?.('running', null);
            if (progress.call_analysis_steps && progress.call_analysis_steps.length > 0) {
              setCallAnalysisSteps(progress.call_analysis_steps);
            }
          }
        });
        opts?.afterUpload?.(data as Record<string, unknown>);
        applyAnalysisResult(data);
        setCallAnalysisSteps(undefined);
      } catch (e: unknown) {
        const message = formatAnalysisError(e);
        const isSoftTimeout = message.includes('still running in the background');
        if (isSoftTimeout) {
          setAnalysisSoftTimeout(true);
          // Don't mark as failed — job may still be running on worker
          onCallAnalysisStatusChange?.('running', null);
        } else {
          setAnalysisError(message);
          onCallAnalysisStatusChange?.('failed', message);
        }
      } finally {
        setReanalyzing(false);
      }
    },
    [grantId, applyAnalysisResult, onCallAnalysisStatusChange],
  );

  // Resume polling after page refresh or API container restart (once per mount)
  useEffect(() => {
    if (resumePollStarted.current) return;
    if (!resumeCallAnalysis && !isMarkedAnalyzing(grantId)) return;
    resumePollStarted.current = true;

    runAnalysis(async () => ({ status: 'running' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Upload ---
  const handleUpload = async (file: File) => {
    setUploading(true);
    setAnalysisError(null);
    setIntelligenceExpanded(true);
    try {
      await runAnalysis(
        () => grantWriting.uploadCall(grantId, file),
        {
          afterUpload: (data) => {
            const payload = data as {
              document_id?: string;
              file_name?: string;
              file_url?: string;
            };
            if (payload.document_id) {
              setUploadedDoc({
                document_id: payload.document_id,
                file_name: payload.file_name || file.name,
                file_url: payload.file_url || '',
                uploaded_at: new Date().toISOString(),
              });
            }
          },
        },
      );
    } finally {
      setUploading(false);
    }
  };

  const handleReanalyze = async (force = false) => {
    if (isAnalyzing && !force) return;
    setAnalysisSoftTimeout(false);
    await runAnalysis(() => grantWriting.analyzeCall(grantId, true));
  };

  const handleResetAnalysis = async () => {
    try {
      await grantWriting.resetCallAnalysis(grantId);
    } catch {
      // Best-effort — clear local state regardless
    }
    resetAnalysis(grantId);
    setReanalyzing(false);
    setAnalysisSoftTimeout(false);
    setCallAnalysisSteps(undefined);
    setAnalysisError(null);
    onCallAnalysisStatusChange?.('idle', null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.pdf') || file.name.endsWith('.docx') || file.name.endsWith('.txt'))) {
      handleUpload(file);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantId]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);

  // --- Voice ---
  const toggleVoice = () => {
    const win = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { setListening(false); return; }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const { transcript } = event.results[0][0];
      onIdeaChange(grantIdea ? `${grantIdea}\n${transcript}` : transcript);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  // --- Google Docs ---
  const extractDocError = (e: unknown, fallback: string): string => {
    const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    return detail || (e as { message?: string }).message || fallback;
  };

  const handleLinkGoogleDoc = async () => {
    if (!docLinkInput.trim()) return;
    setDocSyncState('linking');
    setDocSyncError('');
    try {
      const { data } = await grantsApi.linkGoogleDoc(grantId, docLinkInput.trim());
      onDocLinked?.(data.doc_id, data.doc_url);
      setShowDocLinkInput(false);
      setDocLinkInput('');
      // Auto-pull the linked doc content into the editor
      setDocSyncState('pulling');
      const pullRes = await grantsApi.pullFromGoogleDoc(grantId);
      onDocPulled?.(pullRes.data.content_html || '');
      setDocSyncState('idle');
    } catch (e) {
      setDocSyncError(extractDocError(e, 'Failed to link. Check the URL and try again.'));
      setDocSyncState('error');
    }
  };

  const handleCreateGoogleDoc = async () => {
    setDocSyncState('creating');
    setDocSyncError('');
    try {
      const res = await grantsApi.createGoogleDoc(grantId);
      onDocLinked?.(res.data.doc_id, res.data.doc_url);
      setDocSyncState('idle');
    } catch (e) {
      setDocSyncError(extractDocError(e, 'Failed to create Google Doc.'));
      setDocSyncState('error');
    }
  };

  const handlePullFromDoc = async () => {
    setDocSyncState('pulling');
    setDocSyncError('');
    try {
      const res = await grantsApi.pullFromGoogleDoc(grantId);
      onDocPulled?.(res.data.content_html || '');
      setDocSyncState('idle');
    } catch (e) {
      setDocSyncError(extractDocError(e, 'Failed to pull from Google Doc.'));
      setDocSyncState('error');
    }
  };

  const handlePushToDoc = async () => {
    setDocSyncState('pushing');
    setDocSyncError('');
    try {
      await grantsApi.pushToGoogleDoc(grantId);
      setDocSyncState('idle');
    } catch (e) {
      setDocSyncError(extractDocError(e, 'Failed to push to Google Doc.'));
      setDocSyncState('error');
    }
  };


  // --- Summaries for collapsed state ---
  const docSummary = uploadedDoc?.file_name ?? (hasExistingAnalysis ? 'Analyzed' : 'No document');
  const googleDocSummary = docLinked ? '✓ Linked' : 'Not linked';
  const ideaSummary = grantIdea
    ? grantIdea.slice(0, 90) + (grantIdea.length > 90 ? '…' : '')
    : 'No idea yet';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Single scrollable column */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* 1. Call Document */}
        <CollapsibleSection
          label="Call Document"
          expanded={docExpanded}
          onToggle={() => setDocExpanded(!docExpanded)}
          summary={docSummary}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />

          {uploading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
              Analyzing call document…
            </div>
          ) : uploadedDoc || hasExistingAnalysis ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
              <span className="flex-1 truncate">{uploadedDoc?.file_name ?? 'Call document analyzed'}</span>
              {uploadedDoc?.file_url && (
                <a href={uploadedDoc.file_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-indigo-600">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
                <button
                  onClick={() => handleReanalyze(true)}
                  disabled={false}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Re-analyze' : 'Re-analyze'}
                </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload new
              </button>
            </div>
          ) : (
            <button
              type="button"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-1.5 text-sm py-1 w-full text-left transition-colors ${
                isDragOver ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Upload className="w-3.5 h-3.5 flex-shrink-0" />
              {isDragOver ? 'Drop to upload' : 'Drop PDF/DOCX or click to upload'}
            </button>
          )}
        </CollapsibleSection>

        {/* 2. Google Docs */}
        <CollapsibleSection
          label="Google Docs"
          expanded={docsExpanded}
          onToggle={() => setDocsExpanded(!docsExpanded)}
          summary={googleDocSummary}
        >
          {docLinked ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                <a
                  href={googleDocUrl ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline flex-1 truncate"
                >
                  Google Doc linked
                </a>
                {googleDocLastSynced && (
                  <span className="text-gray-400 shrink-0">
                    synced {new Date(googleDocLastSynced).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePullFromDoc}
                  disabled={docSyncBusy}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                  title="Pull from Google Doc"
                >
                  {docSyncState === 'pulling' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
                  Pull
                </button>
                <button
                  onClick={handlePushToDoc}
                  disabled={docSyncBusy}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                  title="Push to Google Doc"
                >
                  {docSyncState === 'pushing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                  Push
                </button>
              </div>
            </div>
          ) : showDocLinkInput ? (
            <div className="flex gap-2 items-center">
              <input
                type="url"
                value={docLinkInput}
                onChange={(e) => setDocLinkInput(e.target.value)}
                placeholder="https://docs.google.com/document/d/…"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                onKeyDown={(e) => e.key === 'Enter' && handleLinkGoogleDoc()}
                autoFocus
              />
              <button
                onClick={handleLinkGoogleDoc}
                disabled={docSyncBusy || !docLinkInput.trim()}
                className="text-sm text-indigo-600 hover:underline disabled:opacity-50"
              >
                {docSyncState === 'linking' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Link'}
              </button>
              <button
                onClick={() => { setShowDocLinkInput(false); setDocLinkInput(''); }}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDocLinkInput(true)}
                disabled={docSyncBusy}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 disabled:opacity-50 transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
                Link
              </button>
              <button
                onClick={handleCreateGoogleDoc}
                disabled={docSyncBusy}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 disabled:opacity-50 transition-colors"
              >
                {docSyncState === 'creating' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                Create
              </button>
            </div>
          )}

          {docSyncState === 'error' && docSyncError && (
            <p className="text-sm text-red-600 mt-1">{docSyncError}</p>
          )}
        </CollapsibleSection>

        {/* 3. Your Idea */}
        <CollapsibleSection
          label="Your Idea"
          expanded={ideaExpanded}
          onToggle={() => setIdeaExpanded(!ideaExpanded)}
          summary={ideaSummary}
        >
          <div className="relative">
            <textarea
              value={grantIdea}
              onChange={(e) => onIdeaChange(e.target.value)}
              onSelect={(e) => {
                const t = e.currentTarget;
                const sel = t.value.substring(t.selectionStart, t.selectionEnd);
                onSelectionChange?.(sel);
              }}
              onBlur={() => onSelectionChange?.('')}
              rows={10}
              placeholder="Describe your concept — the problem, approach, and impact…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
            <button
              type="button"
              onClick={toggleVoice}
              className={`absolute bottom-2.5 right-2.5 p-1 rounded-full transition-colors ${
                listening ? 'text-red-500' : 'text-gray-400 hover:text-indigo-500'
              }`}
              title="Voice input"
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>
        </CollapsibleSection>

        {/* 4. Call Intelligence */}
        {(hasExistingAnalysis || isAnalyzing) && (
          <CollapsibleSection
            label="Call Intelligence"
            expanded={intelligenceExpanded}
            onToggle={() => setIntelligenceExpanded(!intelligenceExpanded)}
            summary={
              intelligenceExpanded
                ? ''
                : callAnalysisStatus === 'running'
                  ? 'Analyzing…'
                  : 'Analysis ready'
            }
          >
            <CallRequirementsPanel
              callAnalysis={callAnalysis}
              callRequirementsText={callRequirementsText}
              callAnalysisStatus={callAnalysisStatus}
              callAnalysisSteps={callAnalysisSteps}
              onReanalyze={() => handleReanalyze(true)}
              onReset={handleResetAnalysis}
              reanalyzing={isAnalyzing}
              analysisError={analysisError}
              softTimeout={analysisSoftTimeout}
              callIntelligence={callIntelligence}
            />
          </CollapsibleSection>
        )}

        {/* 5. Proposal Structure & Limits (pre-generation constraints editor) */}
        {callAnalysisStatus === 'completed' && sectionConstraints.length > 0 && (
          <CollapsibleSection
            label="Proposal Structure & Limits"
            expanded={constraintsExpanded}
            onToggle={() => setConstraintsExpanded(!constraintsExpanded)}
            summary={constraintsExpanded ? '' : `${sectionConstraints.length} sections`}
          >
            <div className="space-y-3">
              {/* Document totals */}
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 text-gray-500">
                  Total word limit
                  <input
                    type="text"
                    value={totalWordLimit}
                    onChange={(e) => setTotalWordLimit(e.target.value)}
                    placeholder="e.g. 15000"
                    className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-gray-500">
                  Total page limit
                  <input
                    type="text"
                    value={totalPageLimit}
                    onChange={(e) => setTotalPageLimit(e.target.value)}
                    placeholder="e.g. 25"
                    className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
              </div>

              {/* Sections table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-400 font-medium">
                      <th className="px-2 py-1.5 w-6" />
                      <th className="text-left px-2 py-1.5 w-6">#</th>
                      <th className="text-left px-2 py-1.5">Section</th>
                      <th className="text-left px-2 py-1.5 w-20">Words</th>
                      <th className="text-left px-2 py-1.5 w-16">Pages</th>
                      <th className="text-left px-2 py-1.5 w-20">Priority</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sectionConstraints.map((sc, idx) => (
                      <tr
                        key={idx}
                        draggable
                        onDragStart={(e: DragEvent) => {
                          dragIndexRef.current = idx;
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e: DragEvent) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverIdx(idx);
                        }}
                        onDragLeave={() => setDragOverIdx(null)}
                        onDrop={(e: DragEvent) => {
                          e.preventDefault();
                          const from = dragIndexRef.current;
                          if (from === null || from === idx) { setDragOverIdx(null); return; }
                          const updated = [...sectionConstraints];
                          const [moved] = updated.splice(from, 1);
                          updated.splice(idx, 0, moved);
                          setSectionConstraints(updated.map((s, i) => ({ ...s, order: i + 1 })));
                          dragIndexRef.current = null;
                          setDragOverIdx(null);
                        }}
                        onDragEnd={() => { dragIndexRef.current = null; setDragOverIdx(null); }}
                        className={`group transition-colors ${dragOverIdx === idx ? 'bg-indigo-50 border-t-2 border-indigo-300' : 'hover:bg-gray-50'}`}
                      >
                        {/* Drag handle */}
                        <td className="px-2 py-1 text-gray-300 cursor-grab active:cursor-grabbing select-none">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none"/>
                            <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/>
                            <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
                            <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
                            <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none"/>
                            <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>
                          </svg>
                        </td>
                        <td className="px-2 py-1 text-gray-400">{idx + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            value={sc.name}
                            onChange={(e) => {
                              const updated = [...sectionConstraints];
                              updated[idx] = { ...sc, name: e.target.value };
                              setSectionConstraints(updated);
                            }}
                            className="w-full bg-transparent focus:outline-none focus:bg-indigo-50 rounded px-0.5"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={sc.word_limit ?? ''}
                            onChange={(e) => {
                              const updated = [...sectionConstraints];
                              updated[idx] = { ...sc, word_limit: e.target.value ? Number(e.target.value) : null };
                              setSectionConstraints(updated);
                            }}
                            placeholder="—"
                            className="w-full bg-transparent focus:outline-none focus:bg-indigo-50 rounded px-0.5 text-right"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={sc.page_limit ?? ''}
                            onChange={(e) => {
                              const updated = [...sectionConstraints];
                              updated[idx] = { ...sc, page_limit: e.target.value || null };
                              setSectionConstraints(updated);
                            }}
                            placeholder="—"
                            className="w-full bg-transparent focus:outline-none focus:bg-indigo-50 rounded px-0.5 text-right"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={sc.priority ?? 'medium'}
                            onChange={(e) => {
                              const updated = [...sectionConstraints];
                              updated[idx] = { ...sc, priority: e.target.value };
                              setSectionConstraints(updated);
                            }}
                            className="bg-transparent focus:outline-none text-xs text-gray-500"
                          >
                            <option value="high">high</option>
                            <option value="medium">med</option>
                            <option value="low">low</option>
                          </select>
                        </td>
                        <td className="px-1 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => setSectionConstraints(sectionConstraints.filter((_, i) => i !== idx))}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            title="Remove section"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add section row */}
              <button
                type="button"
                onClick={() =>
                  setSectionConstraints([
                    ...sectionConstraints,
                    { name: 'New Section', word_limit: null, page_limit: null, priority: 'medium', order: sectionConstraints.length + 1 },
                  ])
                }
                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                <PlusCircle className="w-3 h-3" />
                Add section
              </button>
            </div>
          </CollapsibleSection>
        )}

      </div>

      {/* Skeleton generation progress */}
      {generating && skeletonSteps && skeletonSteps.length > 0 && (
        <div className="flex-shrink-0 border-t border-gray-200 px-5 py-3">
          <AIThinkingLog
            steps={skeletonSteps.map((s) => ({ id: s.id, label: s.label, status: s.status, detail: s.detail }))}
            progressPct={Math.round(5 + (skeletonSteps.filter(s => s.status === 'done').length / Math.max(skeletonSteps.length, 1)) * 90)}
            title="Generating skeleton…"
          />
        </div>
      )}
      {skeletonError && !generating && (
        <div className="flex-shrink-0 border-t border-red-100 bg-red-50 px-5 py-3">
          <p className="text-xs text-red-600">{skeletonError}</p>
        </div>
      )}

      {/* Gap questions from call_intelligence */}
      {callIntelligence && Array.isArray(callIntelligence.gap_questions) && (callIntelligence.gap_questions as string[]).length > 0 && !generating && (
        <div className="flex-shrink-0 border-t border-blue-100 bg-blue-50 px-5 py-3 space-y-2">
          <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
            Before generating — consider addressing these gaps in your idea:
          </p>
          <ul className="space-y-1">
            {(callIntelligence.gap_questions as string[]).map((q, i) => (
              <li key={i} className="text-xs text-blue-700 flex gap-1.5">
                <span className="text-blue-400 shrink-0">?</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sticky footer */}
      <div className="flex-shrink-0 border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-3">
        {generating && (!skeletonSteps || skeletonSteps.length === 0) && (
          <p className="text-sm text-gray-400">Generating — you can navigate away and come back</p>
        )}
        <button
          onClick={() => {
            const hasConstraints = sectionConstraints.length > 0 || totalWordLimit || totalPageLimit;
            onGenerateSkeleton(
              hasConstraints
                ? {
                    section_constraints: sectionConstraints.map((sc, i) => ({ ...sc, order: sc.order ?? i + 1 })),
                    total_word_limit: totalWordLimit ? parseInt(totalWordLimit.replace(/,/g, ''), 10) || null : null,
                    total_page_limit: totalPageLimit || null,
                  }
                : undefined
            );
          }}
          disabled={!grantIdea.trim() || generating}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? 'Generating skeleton…' : 'Generate Skeleton'}
        </button>
      </div>
    </div>
  );
}
