'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, FileSearch, FileText, Loader2 } from 'lucide-react';
import { api, archive, grants } from '@/lib/api';
import { extractDocId } from '@/lib/extractDocId';

interface WorkspaceFile {
  id: string;
  file_name: string;
  file_url: string;
  file_category?: string;
}

const muted = { color: 'var(--ink-muted)' };

/**
 * Open something in a new browser tab whose URL is only known after a request
 * (authenticated PDF stream, presigned link). The tab is opened synchronously,
 * inside the click, so popup blockers allow it, then pointed at the URL.
 */
export async function openInNewTab(resolve: () => Promise<string>) {
  const tab = window.open('', '_blank');
  try {
    const url = await resolve();
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (e) {
    tab?.close();
    toast.error((e as Error).message || 'Could not open the file.');
  }
}

/** URL for a workspace file: PDFs come through our authenticated stream as a blob. */
async function resolveFileUrl(fileName: string, fileUrl: string): Promise<string> {
  const docId = fileUrl ? extractDocId(fileUrl) : null;
  if (fileName.toLowerCase().endsWith('.pdf') && docId) {
    const res = await api.get(`/documents/${docId}/stream`, { responseType: 'blob' })
      .catch(() => { throw new Error('Could not load PDF — it may have been deleted or moved.'); });
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return url;
  }
  // Internal /content endpoints return JSON {url} pointing at a presigned file.
  if (fileUrl.includes('/content')) {
    let apiPath = fileUrl;
    try { apiPath = new URL(fileUrl).pathname; } catch { /* already relative */ }
    apiPath = apiPath.replace(/^\/api\/v1/, ''); // axios baseURL already has it
    const res = await api.get<{ url?: string }>(apiPath)
      .catch(() => { throw new Error('Could not load file — it may have been deleted or moved.'); });
    if (!res.data.url) throw new Error('Only the parsed text of this file is available.');
    return res.data.url;
  }
  if (!fileUrl) throw new Error('No file URL available.');
  return fileUrl;
}

export function openFileInNewTab(fileName: string, fileUrl: string) {
  return openInNewTab(() => resolveFileUrl(fileName, fileUrl));
}

/** Open the archive entry an archive source section belongs to. */
export function openArchiveSourceInNewTab(sectionId: string, archiveId?: string) {
  return openInNewTab(async () => {
    let id = archiveId;
    if (!id) {
      const res = await archive.getSection(sectionId)
        .catch(() => { throw new Error('Could not load the archive source.'); });
      id = (res.data as { archive_id?: string | null }).archive_id ?? undefined;
    }
    if (!id) throw new Error('This source is not linked to an archive entry.');
    return `/archive/${id}`;
  });
}

/** "Open" menu in the editor top bar: call documents and workspace files, each opened in a new tab. */
export default function OpenInTabMenu({ grantId }: { grantId: string }) {
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

  const callFiles = (files ?? []).filter((f) => f.file_category === 'call_documents');
  const otherFiles = (files ?? []).filter((f) => f.file_category !== 'call_documents');

  const row = (f: WorkspaceFile, Icon: typeof FileText) => (
    <button
      key={f.id}
      onClick={() => { setOpen(false); void openFileInNewTab(f.file_name, f.file_url); }}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--selection-bg)]"
      style={{ color: 'var(--ink-secondary)' }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{f.file_name}</span>
    </button>
  );
  const heading = (text: string) => <div className="ledger-label px-3 pt-2 pb-1">{text}</div>;
  const empty = (text: string) => <div className="px-3 py-1.5 text-xs" style={muted}>{text}</div>;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Open a call document or file in a new tab"
        className="flex items-center gap-1 text-xs px-1.5 py-1 rounded-[var(--radius-sm)]"
        style={{ color: open ? 'var(--ink-primary)' : 'var(--ink-muted)', background: open ? 'var(--accent-secondary)' : 'transparent' }}
      >
        <ExternalLink className="w-4 h-4" /> Open file
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 w-64 max-h-80 overflow-y-auto py-1 rounded-[var(--radius-md)]"
          style={{ background: 'var(--surface-panel)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
        >
          {files === null ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs" style={muted}>
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {heading('Call')}
              {callFiles.length ? callFiles.map((f) => row(f, FileSearch)) : empty('No call documents')}
              {heading('Workspace files')}
              {otherFiles.length ? otherFiles.map((f) => row(f, FileText)) : empty('No other files')}
            </>
          )}
        </div>
      )}
    </div>
  );
}
