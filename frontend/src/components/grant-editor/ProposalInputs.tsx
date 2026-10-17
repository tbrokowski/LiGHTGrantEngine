'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Loader2, Sparkles, CheckCircle2, ChevronDown, ExternalLink, RefreshCw,
} from 'lucide-react';
import { grantWriting } from '@/lib/api';
import {
  runCallAnalysisJob,
  formatAnalysisError,
  isMarkedAnalyzing,
  resetAnalysis,
  type CallAnalysisStatus,
  type AIThinkingStepData,
} from '@/lib/callAnalysisStore';
import CallRequirementsPanel from './CallRequirementsPanel';
import AIThinkingLog from './AIThinkingLog';

/** Style preference: which kind of document we're writing. Drives which archive
 *  examples the RAG prefers (backend/app/ai/proposal_types.py). */
export type ProposalType = 'concept_note' | 'eoi' | 'horizon';

export const PROPOSAL_TYPES: { value: ProposalType; label: string; hint: string }[] = [
  { value: 'concept_note', label: 'Concept note', hint: '2–4 pages · learns from archived concept notes' },
  { value: 'eoi', label: 'EOI', hint: '1–3 pages · short first-stage expression of interest' },
  { value: 'horizon', label: 'Horizon-style proposal', hint: 'Full proposal · learns from archived full proposals' },
];

interface UploadedCallDoc {
  file_name: string;
  file_url: string;
}

interface ProposalInputsProps {
  grantId: string;
  grantIdea: string;
  onIdeaChange: (idea: string) => void;
  proposalType: ProposalType;
  onProposalTypeChange: (type: ProposalType) => void;
  callAnalysis: Record<string, unknown>;
  callRequirements: string;
  callIntelligence: Record<string, unknown>;
  callAnalysisStatus: CallAnalysisStatus;
  onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => void;
  onCallAnalysisStatusChange: (status: CallAnalysisStatus) => void;
  resumeCallAnalysis: boolean;
  generating: boolean;
  draftSteps: AIThinkingStepData[] | null;
  draftError: string | null;
  hasDocument: boolean;
  onGenerate: () => void;
}

const labelStyle = { color: 'var(--ink-muted)' };

export default function ProposalInputs({
  grantId,
  grantIdea,
  onIdeaChange,
  proposalType,
  onProposalTypeChange,
  callAnalysis,
  callRequirements,
  callIntelligence,
  callAnalysisStatus,
  onCallAnalysis,
  onCallAnalysisStatusChange,
  resumeCallAnalysis,
  generating,
  draftSteps,
  draftError,
  hasDocument,
  onGenerate,
}: ProposalInputsProps) {
  // Collapsed to a one-line summary once there's a document to work on.
  const [open, setOpen] = useState(!hasDocument);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedCallDoc | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [softTimeout, setSoftTimeout] = useState(false);
  const [analysisSteps, setAnalysisSteps] = useState<AIThinkingStepData[] | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const resumeStarted = useRef(false);

  const isAnalyzing = uploading || reanalyzing || callAnalysisStatus === 'running';
  const hasCall =
    Object.keys(callAnalysis || {}).length > 0 || !!callRequirements.trim() || callAnalysisStatus !== 'idle';

  // ── Call analysis job (upload → analyze, polled until done) ─────────────────
  const runAnalysis = useCallback(
    async (trigger: () => Promise<unknown>, afterUpload?: (data: Record<string, unknown>) => void) => {
      setAnalysisError(null);
      setSoftTimeout(false);
      setAnalysisSteps(undefined);
      onCallAnalysisStatusChange('running');
      setReanalyzing(true);
      try {
        const data = await runCallAnalysisJob(grantId, trigger, (progress) => {
          if (progress.call_analysis_steps?.length) setAnalysisSteps(progress.call_analysis_steps);
        });
        afterUpload?.(data as Record<string, unknown>);
        onCallAnalysis(data.call_analysis || {}, data.call_requirements);
        onCallAnalysisStatusChange('completed');
        setAnalysisSteps(undefined);
      } catch (e: unknown) {
        const message = formatAnalysisError(e);
        if (message.includes('still running in the background')) {
          setSoftTimeout(true); // job may still finish on the worker
        } else {
          setAnalysisError(message);
          onCallAnalysisStatusChange('failed');
        }
      } finally {
        setReanalyzing(false);
      }
    },
    [grantId, onCallAnalysis, onCallAnalysisStatusChange],
  );

  // Resume polling after a refresh while analysis is still running.
  useEffect(() => {
    if (resumeStarted.current) return;
    if (!resumeCallAnalysis && !isMarkedAnalyzing(grantId)) return;
    resumeStarted.current = true;
    runAnalysis(async () => ({ status: 'running' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await runAnalysis(() => grantWriting.uploadCall(grantId, file), (data) => {
        setUploadedDoc({
          file_name: (data.file_name as string) || file.name,
          file_url: (data.file_url as string) || '',
        });
      });
    } finally {
      setUploading(false);
    }
  };

  const handleReanalyze = () => runAnalysis(() => grantWriting.analyzeCall(grantId, true));

  const handleResetAnalysis = async () => {
    try { await grantWriting.resetCallAnalysis(grantId); } catch { /* best-effort */ }
    resetAnalysis(grantId);
    setReanalyzing(false);
    setSoftTimeout(false);
    setAnalysisSteps(undefined);
    setAnalysisError(null);
    onCallAnalysisStatusChange('idle');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(pdf|docx|txt)$/i.test(file.name)) handleUpload(file);
  };

  const typeMeta = PROPOSAL_TYPES.find((t) => t.value === proposalType) ?? PROPOSAL_TYPES[2];
  const canGenerate = !!grantIdea.trim() || hasCall;
  const callSummary = uploadedDoc?.file_name ?? (hasCall ? 'Call analyzed' : 'No call document');

  return (
    <section
      className="rounded-[var(--radius-md)]"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-panel)' }}
    >
      {/* Header — doubles as the collapsed summary */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left"
      >
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          style={labelStyle}
        />
        <span className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Proposal inputs</span>
        {!open && (
          <span className="text-xs truncate" style={labelStyle}>
            {typeMeta.label} · {callSummary} · {grantIdea.trim() ? grantIdea.trim().slice(0, 80) : 'No blurb yet'}
          </span>
        )}
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {/* 1. Blurb */}
          <div className="px-5 py-4 space-y-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            <label htmlFor="proposal-blurb" className="ledger-label block">Project idea</label>
            <textarea
              id="proposal-blurb"
              value={grantIdea}
              onChange={(e) => onIdeaChange(e.target.value)}
              rows={5}
              placeholder="The problem, your approach, and the impact — a paragraph or two is enough."
              className="w-full text-sm px-3 py-2.5 resize-y rounded-[var(--radius-sm)] focus:outline-none"
              style={{
                background: 'var(--surface-sunken)',
                color: 'var(--ink-primary)',
                border: '1px solid var(--rule-subtle)',
              }}
            />
          </div>

          {/* 2. Call document */}
          <div className="px-5 py-4 space-y-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            <span className="ledger-label block">Call document</span>
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
            {hasCall || uploading ? (
              <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={labelStyle} />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--state-success)' }} />
                )}
                <span className="flex-1 truncate">
                  {isAnalyzing ? 'Analyzing call document…' : callSummary}
                </span>
                {uploadedDoc?.file_url && (
                  <a href={uploadedDoc.file_url} target="_blank" rel="noopener noreferrer" title="Open file" style={labelStyle}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button type="button" onClick={handleReanalyze} disabled={isAnalyzing}
                  className="flex items-center gap-1 text-xs disabled:opacity-50" style={labelStyle}>
                  <RefreshCw className="w-3 h-3" /> Re-analyze
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={isAnalyzing}
                  className="flex items-center gap-1 text-xs disabled:opacity-50" style={labelStyle}>
                  <Upload className="w-3 h-3" /> Replace
                </button>
                <button type="button" onClick={() => setShowAnalysis((v) => !v)}
                  className="flex items-center gap-1 text-xs" style={labelStyle}>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showAnalysis ? '' : '-rotate-90'}`} />
                  Analysis
                </button>
              </div>
            ) : (
              <button
                type="button"
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 text-sm py-4 rounded-[var(--radius-sm)]"
                style={{
                  border: `1px dashed ${isDragOver ? 'var(--rule-accent)' : 'var(--rule-strong)'}`,
                  color: isDragOver ? 'var(--ink-primary)' : 'var(--ink-muted)',
                  background: isDragOver ? 'var(--selection-bg)' : 'transparent',
                }}
              >
                <Upload className="w-4 h-4" />
                {isDragOver ? 'Drop to upload' : 'Drop the call PDF / DOCX here, or click to upload'}
              </button>
            )}
            {(showAnalysis || analysisError) && hasCall && (
              <div className="pt-2">
                <CallRequirementsPanel
                  callAnalysis={callAnalysis}
                  callRequirementsText={callRequirements}
                  callAnalysisStatus={callAnalysisStatus}
                  callAnalysisSteps={analysisSteps}
                  onReanalyze={handleReanalyze}
                  onReset={handleResetAnalysis}
                  reanalyzing={isAnalyzing}
                  analysisError={analysisError}
                  softTimeout={softTimeout}
                  callIntelligence={callIntelligence}
                />
              </div>
            )}
          </div>

          {/* 3. Proposal type — steers which archive examples the RAG uses */}
          <div className="px-5 py-4 space-y-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            <span className="ledger-label block">Proposal type</span>
            <div role="radiogroup" aria-label="Proposal type" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PROPOSAL_TYPES.map((t) => {
                const selected = t.value === proposalType;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onProposalTypeChange(t.value)}
                    className="text-left px-3 py-2.5 rounded-[var(--radius-sm)] transition-colors"
                    style={{
                      border: `1px solid ${selected ? 'var(--rule-accent)' : 'var(--rule-subtle)'}`,
                      background: selected ? 'var(--accent-secondary)' : 'transparent',
                    }}
                  >
                    <span className="block text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>{t.label}</span>
                    <span className="block text-xs mt-0.5" style={labelStyle}>{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate */}
          <div className="px-5 py-3 flex items-center justify-end gap-3">
            {hasDocument && !generating && (
              <span className="text-xs" style={labelStyle}>Regenerating replaces the current document.</span>
            )}
            <button
              type="button"
              onClick={() => {
                if (hasDocument && !window.confirm('Generate a new proposal? This replaces the current document.')) return;
                onGenerate();
              }}
              disabled={!canGenerate || generating || isAnalyzing}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-[var(--radius-sm)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Generating…' : hasDocument ? 'Regenerate proposal' : 'Generate proposal'}
            </button>
          </div>
        </div>
      )}

      {/* Progress stays visible even when the inputs are collapsed */}
      {generating && (
        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {draftSteps && draftSteps.length > 0 ? (
            <AIThinkingLog
              steps={draftSteps}
              progressPct={Math.round(5 + (draftSteps.filter((s) => s.status === 'done').length / draftSteps.length) * 90)}
              title={`Writing your ${typeMeta.label.toLowerCase()}…`}
            />
          ) : (
            <p className="text-xs" style={labelStyle}>Starting — you can leave this page and come back.</p>
          )}
        </div>
      )}
      {draftError && !generating && (
        <p className="px-5 py-3 text-xs" style={{ color: 'var(--state-danger)', borderTop: '1px solid var(--rule-subtle)' }}>
          {draftError}
        </p>
      )}
    </section>
  );
}
