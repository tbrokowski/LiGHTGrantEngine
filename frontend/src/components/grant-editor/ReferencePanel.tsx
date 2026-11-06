'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ChevronDown, Columns2, ExternalLink, FilePen, FileSearch, FileText, FileType2, Loader2, ScrollText, X,
} from 'lucide-react';
import { api, grants } from '@/lib/api';
import { extractDocId } from '@/lib/extractDocId';
import type { CallAnalysisStatus } from '@/lib/callAnalysisStore';
import { useDocumentPdfBlob } from '@/hooks/useDocumentPdfBlob';
import CallRequirementsPanel from './CallRequirementsPanel';
import ArchiveSourcePane from './ArchiveSourcePane';
import { openArchiveSourceInNewTab, openFileInNewTab } from './openInNewTab';
import WordDocEditor from '@/components/grant-workspace/WordDocEditor';

/** What a reference panel beside the editor shows. */
export type ReferenceItem =
  | { kind: 'file'; fileName: string; fileUrl: string }
  // A Word file (.docx) — edited in place in OnlyOffice, like a main-editor tab.
  | { kind: 'word'; docId: string; fileName: string }
  // One of the grant's own writing documents (the proposal or another tab), read-only.
  | { kind: 'writing'; docId: string; title: string }
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
    case 'word': return item.fileName;
    case 'writing': return item.title;
    case 'call-analysis': return 'Call analysis';
    case 'call-text': return 'Call text';
    case 'archive': return item.label;
  }
}

/** Two items are "the same" panel content (used to focus instead of duplicating). */
export function sameReference(a: ReferenceItem, b: ReferenceItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.fileUrl === b.fileUrl;
  if ((a.kind === 'word' && b.kind === 'word') || (a.kind === 'writing' && b.kind === 'writing')) return a.docId === b.docId;
  if (a.kind === 'archive' && b.kind === 'archive') return a.sectionId === b.sectionId;
  return true;
}

interface WorkspaceFile {
  id: string;
  file_name: string;
  file_url: string;
  file_type?: string | null;
  file_category?: string;
}

/** One of the grant's writing documents, as the picker lists them. */
export interface GrantDocumentRef {
  id: string;
  title: string;
  /** Set for a Word file tab: the Document that holds the .docx. */
  documentId?: string | null;
}

const isDocxName = (name: string) => name.toLowerCase().endsWith('.docx');

/** A Saved file opens in the Word editor when it's an uploaded .docx. */
function workspaceFileItem(f: WorkspaceFile): ReferenceItem {
  const docId = extractDocId(f.file_url);
  if (docId && ((f.file_type ?? '').toLowerCase() === 'docx' || isDocxName(f.file_name))) {
    return { kind: 'word', docId, fileName: f.file_name };
  }
  return { kind: 'file', fileName: f.file_name, fileUrl: f.file_url };
}

function grantDocumentItem(d: GrantDocumentRef): ReferenceItem {
  return d.documentId
    ? { kind: 'word', docId: d.documentId, fileName: isDocxName(d.title) ? d.title : `${d.title}.docx` }
    : { kind: 'writing', docId: d.id, title: d.title };
}

const muted = { color: 'var(--ink-muted)' };

// ── Picker: choose what to open ──────────────────────────────────────────────

interface ReferencePickerProps {
  grantId: string;
  /** The proposal and the grant's other writing documents. */
  documents?: GrantDocumentRef[];
  onPick: (item: ReferenceItem) => void;
  /** 'button' = labelled top-bar button; 'chevron' = compact swap control in a panel header. */
  variant: 'button' | 'chevron';
  disabled?: boolean;
}

export function ReferencePicker({ grantId, documents = [], onPick, variant, disabled }: ReferencePickerProps) {
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
          {documents.length > 0 && heading('Grant documents')}
          {documents.map((d) => row(`doc-${d.id}`,
            d.documentId ? <FileType2 className="w-3.5 h-3.5 shrink-0" /> : <FilePen className="w-3.5 h-3.5 shrink-0" />,
            d.title, grantDocumentItem(d)))}
          {heading('Call')}
          {callFiles.map((f) => row(f.id, <FileSearch className="w-3.5 h-3.5 shrink-0" />, f.file_name, workspaceFileItem(f)))}
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
            otherFiles.map((f) => {
              const item = workspaceFileItem(f);
              const icon = item.kind === 'word' ? <FileType2 className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />;
              return row(f.id, icon, f.file_name, item);
            })
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

function looksLikePdf(url: string) {
  try {
    return new URL(url, window.location.href).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().includes('.pdf');
  }
}

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

  // Names often lack the extension (the add-file form strips it), so also go
  // by where the file actually lives.
  if (docId && (isPdf || (resolved && looksLikePdf(resolved)))) {
    return <PdfView docId={docId} fileName={fileName} />;
  }

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
  if (isPdf || looksLikePdf(src)) {
    // External PDF: the browser's viewer shows it inline unless the site
    // forbids embedding, so keep a way out to a new tab.
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0 flex items-center justify-end px-3 py-1 text-xs" style={{ ...muted, borderBottom: '1px solid var(--rule-subtle)' }}>
          <a href={src} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline">
            Not showing? Open in a new tab <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <iframe src={src} className="flex-1 w-full border-0" title={fileName} />
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

// ── Writing document (read-only) ─────────────────────────────────────────────
// Shown in a sandboxed frame: no scripts, nothing reaches the page. Edits
// happen in the main editor, so the frame only catches up once typing pauses.

const PREVIEW_CSS = `
  body { font: 15px/1.6 Georgia, 'Times New Roman', serif; color: #1f1f1d; margin: 0; padding: 20px 28px; }
  h1, h2, h3, h4 { font-family: Arial, sans-serif; line-height: 1.3; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #d4d4d0; padding: 4px 8px; vertical-align: top; }
  img { max-width: 100%; }
  mark { background: #fff3a3; }
`;

function WritingView({ html }: { html: string }) {
  const [shown, setShown] = useState(html);
  useEffect(() => {
    const t = setTimeout(() => setShown(html), 800);
    return () => clearTimeout(t);
  }, [html]);
  if (!shown.replace(/<[^>]+>/g, '').trim()) {
    return <div className="flex-1 flex items-center justify-center text-sm italic" style={muted}>This document is empty.</div>;
  }
  return (
    <iframe
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_CSS}</style></head><body>${shown}</body></html>`}
      className="flex-1 w-full border-0"
      style={{ background: '#fff' }}
      title="Document preview"
    />
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

interface ReferencePanelProps {
  grantId: string;
  item: ReferenceItem;
  documents?: GrantDocumentRef[];
  /** Live HTML of a writing document, for read-only panels. */
  getWritingHtml?: (docId: string) => string | null;
  /** Switch the main editor to this writing document. */
  onEditDocument?: (docId: string) => void;
  onReplace: (item: ReferenceItem) => void;
  onClose: () => void;
  callAnalysis: Record<string, unknown>;
  callRequirements: string;
  callIntelligence: Record<string, unknown>;
  callAnalysisStatus: CallAnalysisStatus;
}

export default function ReferencePanel({
  grantId, item, documents, getWritingHtml, onEditDocument, onReplace, onClose,
  callAnalysis, callRequirements, callIntelligence, callAnalysisStatus,
}: ReferencePanelProps) {
  // Panels saved before Word files had their own kind still open in the Word editor.
  const fileDocId = item.kind === 'file' ? extractDocId(item.fileUrl) : null;
  const word = item.kind === 'word' ? item
    : item.kind === 'file' && fileDocId && isDocxName(item.fileName) ? { docId: fileDocId, fileName: item.fileName }
    : null;
  const label = referenceLabel(item);
  // Files and archive sources can also pop out into their own browser tab.
  const openInTab =
    item.kind === 'file' && !word ? () => openFileInNewTab(item.fileName, item.fileUrl)
    : item.kind === 'archive' ? () => openArchiveSourceInNewTab(item.sectionId, item.archiveId)
    : null;

  return (
    <div className="flex flex-col flex-1 h-full min-w-0 overflow-hidden" style={{ background: 'var(--surface-panel)' }}>
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 py-2 text-xs"
        style={{ borderBottom: '1px solid var(--rule-subtle)', color: 'var(--ink-secondary)' }}
      >
        <span className="truncate font-medium" title={label}>{label}</span>
        <ReferencePicker grantId={grantId} documents={documents} onPick={onReplace} variant="chevron" />
        <span className="flex-1" />
        {item.kind === 'writing' && onEditDocument && (
          <button onClick={() => onEditDocument(item.docId)} className="hover:underline" style={muted} title="Edit this document in the main editor">
            Edit
          </button>
        )}
        {openInTab && (
          <button onClick={() => void openInTab()} title="Open in new tab" style={muted}>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onClose} title="Close panel" style={muted}><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {word && <WordDocEditor key={word.docId} grantId={grantId} docId={word.docId} fileName={word.fileName} variant="panel" />}
        {item.kind === 'file' && !word && <FileView key={item.fileUrl} fileName={item.fileName} fileUrl={item.fileUrl} />}
        {item.kind === 'writing' && <WritingView html={getWritingHtml?.(item.docId) ?? ''} />}
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
