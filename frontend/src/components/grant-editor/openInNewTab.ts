'use client';

import { toast } from 'sonner';
import { api, archive } from '@/lib/api';
import { extractDocId } from '@/lib/extractDocId';

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
