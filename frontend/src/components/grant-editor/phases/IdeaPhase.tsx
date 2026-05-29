'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Upload, Mic, MicOff, Loader2, Sparkles, CheckCircle2, ChevronDown,
  ExternalLink, Link2, PlusCircle, CloudUpload, CloudDownload, RefreshCw,
} from 'lucide-react';
import { grantWriting, grants as grantsApi } from '@/lib/api';
import {
  runCallAnalysisJob,
  formatAnalysisError,
  isMarkedAnalyzing,
  type CallAnalysisStatus,
} from '@/lib/callAnalysisStore';
import CallRequirementsPanel from '../CallRequirementsPanel';

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
  onGenerateSkeleton: () => void;
  generating: boolean;
  googleDocId?: string | null;
  googleDocUrl?: string | null;
  googleDocLastSynced?: string | null;
  onDocLinked?: (docId: string, docUrl: string) => void;
  onDocPulled?: (html: string) => void;
  onSelectionChange?: (text: string) => void;
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
          className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`}
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
  googleDocId,
  googleDocUrl,
  googleDocLastSynced,
  onDocLinked,
  onDocPulled,
  onSelectionChange,
}: IdeaPhaseProps) {
  // Panel expand state
  const [ideaExpanded, setIdeaExpanded] = useState(true);
  const [docExpanded, setDocExpanded] = useState(true);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [intelligenceExpanded, setIntelligenceExpanded] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedCallDoc | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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
      setIntelligenceExpanded(true);
      onCallAnalysisStatusChange?.('running', null);
      setReanalyzing(true);
      try {
        const data = await runCallAnalysisJob(grantId, trigger, (progress) => {
          if (progress.call_analysis_status === 'running') {
            onCallAnalysisStatusChange?.('running', null);
          }
        });
        opts?.afterUpload?.(data as Record<string, unknown>);
        applyAnalysisResult(data);
      } catch (e: unknown) {
        const message = formatAnalysisError(e);
        setAnalysisError(message);
        onCallAnalysisStatusChange?.('failed', message);
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

  const handleReanalyze = async () => {
    if (isAnalyzing) return;
    await runAnalysis(() => grantWriting.analyzeCall(grantId));
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
                  onClick={handleReanalyze}
                  disabled={isAnalyzing}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  Re-analyze
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
              onReanalyze={handleReanalyze}
              reanalyzing={isAnalyzing}
              analysisError={analysisError}
            />
          </CollapsibleSection>
        )}

      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-3">
        {generating && (
          <p className="text-sm text-gray-400">Generating — you can navigate away and come back</p>
        )}
        <button
          onClick={onGenerateSkeleton}
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
