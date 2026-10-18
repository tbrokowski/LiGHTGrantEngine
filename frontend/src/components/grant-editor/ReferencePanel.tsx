'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ChevronDown, Columns2, ExternalLink, FileSearch, FileText, Loader2, ScrollText, X,
} from 'lucide-react';
import { api, grants } from '@/lib/api';
import { extractDocId } from '@/lib/extractDocId';
import type { CallAnalysisStatus } from '@/lib/callAnalysisStore';
import { useDocumentPdfBlob } from '@/hooks/useDocumentPdfBlob';
import CallRequirementsPanel from './CallRequirementsPanel';
import ArchiveSourcePane from './ArchiveSourcePane';
import { openArchiveSourceInNewTab, openFileInNewTab } from './openInNewTab';

/** What a reference panel beside the editor shows. */
export type ReferenceItem =
  | { kind: 'file'; fileName: string; fileUrl: string }
  | { kind: 'call-analysis' }
  | { kind: 'call-text' }
  | { kind: 'archive'; sectionId: string; archiveId?: string; label: string };

export interface ReferencePanelState {
  id: string;
  item: ReferenceItem;
  width: number;
}

export function referenceLabel(item: ReferenceItem): string {
  switch (item.kind) {
    case 'file': return item.fileName;
    case 'call-analysis': return 'Call analysis';
    case 'call-text': return 'Call text';
    case 'archive': return item.label;
  }
}

/** Two items are "the same" panel content (used to focus instead of duplicating). */
export function sameReference(a: ReferenceItem, b: ReferenceItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.fileUrl === b.fileUrl;
  if (a.kind === 'archive' && b.kind === 'archive') return a.sectionId === b.sectionId;
  return true;
}

interface WorkspaceFile {
  id: string;
  file_name: string;
  file_url: string;
  file_category?: string;
}

const muted = { color: 'var(--ink-muted)' };

// ── Picker: choose what to open ──────────────────────────────────────────────

interface ReferencePickerProps {
  grantId: string;
  onPick: (item: ReferenceItem) => void;
  /** 'button' = labelled top-bar button; 'chevron' = compact swap control in a panel header. */
  variant: 'button' | 'chevron';
  disabled?: boolean;
}

export function ReferencePicker({ grantId, onPick, variant, disabled }: ReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    grants.listFiles(grantId)
      .then((res) => setFiles((res.data ?? []) as WorkspaceFile[]))
      .catch(() => setFiles([]));
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, grantId]);

  const pick = (item: ReferenceItem) => { setOpen(false); onPick(item); };
  const callFiles = (files ?? []).filter((f) => f.file_category === 'call_documents');
  const otherFiles = (files ?? []).filter((f) => f.file_category !== 'call_documents');

  const row = (key: string, icon: React.ReactNode, label: string, item: ReferenceItem) => (
    <button
      key={key}
      onClick={() => pick(item)}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--selection-bg)]"
      style={{ color: 'var(--ink-secondary)' }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  const heading = (text: string) => (
    <div className="ledger-label px-3 pt-2 pb-1">{text}</div>
  );

  return (
    <div ref={ref} className="relative">
      {variant === 'button' ? (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          title={disabled ? 'Close a panel to open another' : 'Open a document beside the editor'}
          className="flex items-center gap-1 text-xs px-1.5 py-1 rounded-[var(--radius-sm)] disabled:opacity-40"
          style={{ color: open ? 'var(--ink-primary)' : 'var(--ink-muted)', background: open ? 'var(--accent-secondary)' : 'transparent' }}
        >
          <Columns2 className="w-4 h-4" /> Open beside
        </button>
      ) : (
        <button onClick={() => setOpen((v) => !v)} title="Show something else here" style={muted}>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
      {open && (
        <div
          className={`absolute top-full mt-1 z-50 w-64 max-h-80 overflow-y-auto py-1 rounded-[var(--radius-md)] ${variant === 'button' ? 'right-0' : 'left-0'}`}
          style={{ background: 'var(--surface-panel)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
        >
          {heading('Call')}
          {callFiles.map((f) => row(f.id, <FileSearch className="w-3.5 h-3.5 shrink-0" />, f.file_name,
            { kind: 'file', fileName: f.file_name, fileUrl: f.file_url }))}
          {row('call-analysis', <ScrollText className="w-3.5 h-3.5 shrink-0" />, 'Call analysis', { kind: 'call-analysis' })}
          {row('call-text', <ScrollText className="w-3.5 h-3.5 shrink-0" />, 'Call text (extracted)', { kind: 'call-text' })}
          {heading('Workspace files')}
          {files === null ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs" style={muted}>
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          ) : otherFiles.length === 0 ? (
            <div className="px-3 py-1.5 text-xs" style={muted}>No other files</div>
          ) : (
            otherFiles.map((f) => row(f.id, <FileText className="w-3.5 h-3.5 shrink-0" />, f.file_name,
              { kind: 'file', fileName: f.file_name, fileUrl: f.file_url }))
          )}
        </div>
      )}
    </div>
  );
}

// ── PDF viewer ───────────────────────────────────────────────────────────────
// Fetches our authenticated /stream endpoint as a blob and hands it to the
// browser's built-in PDF viewer (search, zoom, page nav). Avoids pdf.js, which
// fails to initialise under the current Next 14 webpack build.
function PdfView({ docId, fileName }: { docId: string; fileName: string }) {
  const { blobUrl, loading, error } = useDocumentPdfBlob(docId);
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm" style={muted}>
        <AlertCircle className="w-8 h-8" style={{ color: 'var(--state-danger)' }} />
        {error}
      </div>
    );
  }
  if (loading || !blobUrl) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm" style={muted}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading PDF…
      </div>
    );
  }
  return <iframe src={blobUrl} className="flex-1 w-full border-0" title={fileName} />;
}

// ── File viewer ──────────────────────────────────────────────────────────────

function FileView({ fileName, fileUrl }: { fileName: string; fileUrl: string }) {
  const docId = fileUrl ? extractDocId(fileUrl) : null;
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const needsResolve = !(isPdf && docId) && fileUrl.includes('/content');
  const [resolved, setResolved] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Internal /content endpoints return JSON {url} pointing at a presigned file.
  useEffect(() => {
    if (!needsResolve) return;
    let apiPath = fileUrl;
    try { apiPath = new URL(fileUrl).pathname; } catch { /* already relative */ }
    apiPath = apiPath.replace(/^\/api\/v1/, ''); // axios baseURL already has it
    setError('');
    setResolved(null);
    api.get<{ url?: string }>(apiPath)
      .then((res) => {
        if (res.data.url) setResolved(res.data.url);
        else setError('Only the parsed text of this file is available.');
      })
      .catch(() => setError('Could not load file — it may have been deleted or moved.'));
  }, [fileUrl, needsResolve]);

  if (isPdf && docId) return <PdfView docId={docId} fileName={fileName} />;

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm" style={muted}>
        <AlertCircle className="w-8 h-8" style={{ color: 'var(--state-danger)' }} />
        {error}
      </div>
    );
  }
  if (needsResolve && !resolved) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm" style={muted}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const src = resolved ?? fileUrl;
  if (!src) return <div className="flex-1 flex items-center justify-center text-sm" style={muted}>No file URL available.</div>;
  if (isPdf || src.toLowerCase().includes('.pdf')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm" style={muted}>
        This PDF can only be opened in a new tab.
        <a href={src} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 underline">
          <ExternalLink className="w-3 h-3" /> Open PDF
        </a>
      </div>
    );
  }
  const isGoogle = src.includes('docs.google.com') || src.includes('drive.google.com');
  const embedSrc = isGoogle ? src.replace('/edit', '/preview').replace('/view', '/preview') : src;
  return (
    <iframe src={embedSrc} className="flex-1 w-full border-0" title={fileName}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

interface ReferencePanelProps {
  grantId: string;
  item: ReferenceItem;
  onReplace: (item: ReferenceItem) => void;
  onClose: () => void;
  callAnalysis: Record<string, unknown>;
  callRequirements: string;
  callIntelligence: Record<string, unknown>;
  callAnalysisStatus: CallAnalysisStatus;
}

export default function ReferencePanel({
  grantId, item, onReplace, onClose, callAnalysis, callRequirements, callIntelligence, callAnalysisStatus,
}: ReferencePanelProps) {
  const label = referenceLabel(item);
  // Files and archive sources can also pop out into their own browser tab.
  const openInTab =
    item.kind === 'file' ? () => openFileInNewTab(item.fileName, item.fileUrl)
    : item.kind === 'archive' ? () => openArchiveSourceInNewTab(item.sectionId, item.archiveId)
    : null;

  return (
    <div className="flex flex-col flex-1 h-full min-w-0 overflow-hidden" style={{ background: 'var(--surface-panel)' }}>
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 py-2 text-xs"
        style={{ borderBottom: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}
      >
        <span className="truncate font-medium" title={label}>{label}</span>
        <ReferencePicker grantId={grantId} onPick={onReplace} variant="chevron" />
        <span className="flex-1" />
        {openInTab && (
          <button onClick={() => void openInTab()} title="Open in new tab" style={muted}>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onClose} title="Close panel" style={muted}><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {item.kind === 'file' && <FileView key={item.fileUrl} fileName={item.fileName} fileUrl={item.fileUrl} />}
        {item.kind === 'archive' && <ArchiveSourcePane key={item.sectionId} sectionId={item.sectionId} />}
        {item.kind === 'call-analysis' && (
          <div className="flex-1 overflow-y-auto p-4">
            {Object.keys(callAnalysis).length || callRequirements ? (
              <CallRequirementsPanel
                callAnalysis={callAnalysis}
                callRequirementsText={callRequirements}
                callAnalysisStatus={callAnalysisStatus}
                callIntelligence={callIntelligence}
              />
            ) : (
              <p className="text-sm italic" style={muted}>Upload a call document in Proposal inputs to see its analysis.</p>
            )}
          </div>
        )}
        {item.kind === 'call-text' && (
          <div className="flex-1 overflow-y-auto p-5">
            {callRequirements ? (
              <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans" style={{ color: 'var(--ink-secondary)' }}>
                {callRequirements}
              </pre>
            ) : (
              <p className="text-sm italic" style={muted}>No call text yet — upload a call document in Proposal inputs.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
