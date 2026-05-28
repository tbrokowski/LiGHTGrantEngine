'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { grants, api } from '@/lib/api';
import {
  Save, Check, AlertCircle, FileText, CloudUpload, CloudDownload,
  Loader2, Link2, ExternalLink, X,
} from 'lucide-react';
import SingleDocEditor from '../SingleDocEditor';

interface NewDocumentPaneProps {
  grantId: string;
  docId: string;
  label: string;
}

interface PerDocLink {
  googleDocId: string;
  googleDocUrl: string;
}

function loadDocLink(docId: string): PerDocLink | null {
  try {
    const raw = localStorage.getItem(`new-doc-gdoc-${docId}`);
    return raw ? (JSON.parse(raw) as PerDocLink) : null;
  } catch { return null; }
}

function saveDocLink(docId: string, link: PerDocLink) {
  localStorage.setItem(`new-doc-gdoc-${docId}`, JSON.stringify(link));
}

export default function NewDocumentPane({ grantId, docId, label }: NewDocumentPaneProps) {
  const localKey = `new-doc-${docId}`;
  const [documentHtml, setDocumentHtml] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(localKey) ?? '';
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const fileIdRef = useRef<string | null>(null);

  // Per-doc Google Doc link (stored in localStorage)
  const [docLink, setDocLink] = useState<PerDocLink | null>(() =>
    typeof window !== 'undefined' ? loadDocLink(docId) : null
  );
  const [syncState, setSyncState] = useState<'idle' | 'pushing' | 'pulling' | 'success' | 'error'>('idle');
  const [linkMode, setLinkMode] = useState<'none' | 'link-input'>('none');
  const [linkUrl, setLinkUrl] = useState('');
  const [linking, setLinking] = useState(false);

  // Auto-push debounce timer
  const autoPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docChangedRef = useRef(false);

  const handleDocumentChange = useCallback((html: string, _words: number, _headings: string[]) => {
    setDocumentHtml(html);
    localStorage.setItem(localKey, html);
    docChangedRef.current = true;
    // Auto-push to Google Doc after 3s if linked
    if (autoPushTimer.current) clearTimeout(autoPushTimer.current);
    autoPushTimer.current = setTimeout(async () => {
      if (!docChangedRef.current) return;
      const link = loadDocLink(docId);
      if (!link) return;
      docChangedRef.current = false;
      setSyncState('pushing');
      try {
        await grants.pushContentToDoc(grantId, link.googleDocId, html);
        setSyncState('success');
        setTimeout(() => setSyncState('idle'), 3000);
      } catch {
        setSyncState('error');
        setTimeout(() => setSyncState('idle'), 3000);
      }
    }, 3000);
  }, [localKey, grantId, docId]);

  useEffect(() => {
    return () => { if (autoPushTimer.current) clearTimeout(autoPushTimer.current); };
  }, []);

  // ── Google Doc linking ───────────────────────────────────────────────────────
  const handleCreateDoc = async () => {
    setLinking(true);
    try {
      const res = await grants.createGoogleDoc(grantId);
      const link: PerDocLink = { googleDocId: res.data.doc_id, googleDocUrl: res.data.doc_url };
      setDocLink(link);
      saveDocLink(docId, link);
    } finally {
      setLinking(false);
    }
  };

  const handleLinkDoc = async () => {
    if (!linkUrl.trim()) return;
    setLinking(true);
    try {
      const res = await grants.linkGoogleDoc(grantId, linkUrl.trim());
      const link: PerDocLink = { googleDocId: res.data.doc_id, googleDocUrl: res.data.doc_url };
      setDocLink(link);
      saveDocLink(docId, link);
      setLinkMode('none');
      setLinkUrl('');
    } finally {
      setLinking(false);
    }
  };

  const handlePush = async () => {
    if (!docLink) return;
    setSyncState('pushing');
    try {
      await grants.pushContentToDoc(grantId, docLink.googleDocId, documentHtml);
      setSyncState('success');
      setTimeout(() => setSyncState('idle'), 3000);
    } catch {
      setSyncState('error');
      setTimeout(() => setSyncState('idle'), 3000);
    }
  };

  const handlePull = async () => {
    if (!docLink) return;
    setSyncState('pulling');
    try {
      const res = await grants.pullContentFromDoc(grantId, docLink.googleDocId);
      setDocumentHtml(res.data.content_html);
      localStorage.setItem(localKey, res.data.content_html);
      setSyncState('success');
      setTimeout(() => setSyncState('idle'), 3000);
    } catch {
      setSyncState('error');
      setTimeout(() => setSyncState('idle'), 3000);
    }
  };

  const syncBusy = syncState === 'pushing' || syncState === 'pulling';

  // ── Save to Files ────────────────────────────────────────────────────────────
  const handleSaveToFiles = async () => {
    if (!documentHtml || documentHtml === '<p></p>') return;
    setSaveStatus('saving');
    try {
      if (fileIdRef.current) {
        await grants.updateFile(grantId, fileIdRef.current, {
          description: `Updated ${new Date().toLocaleString()}`,
        });
      } else {
        const blob = new Blob([documentHtml], { type: 'text/html' });
        const file = new File([blob], `${label}.html`, { type: 'text/html' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('grant_id', grantId);
        formData.append('document_type', 'other');

        const uploadRes = await api.post('/documents/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const fileRes = await grants.addFile(grantId, {
          file_name: label,
          file_url: uploadRes.data.id
            ? `${window.location.origin}/api/v1/documents/${uploadRes.data.id}/content`
            : '',
          file_category: 'other',
          source_type: 'internal',
          description: 'Created in editor split view',
        });
        fileIdRef.current = fileRes.data.id;
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Sub-toolbar — Google Docs + Save to Files */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-1 border-b border-gray-200 bg-white text-xs shadow-sm">
        {/* Left: Google Doc controls */}
        <div className="flex items-center gap-2 min-w-0">
          {docLink ? (
            <>
              <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <a
                href={docLink.googleDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline flex items-center gap-0.5 truncate max-w-[140px]"
              >
                Google Doc <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
              </a>
              {syncState === 'pushing' && (
                <span className="flex items-center gap-1 text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Syncing…
                </span>
              )}
              {syncState === 'pulling' && (
                <span className="flex items-center gap-1 text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Pulling…
                </span>
              )}
              {syncState === 'success' && (
                <span className="flex items-center gap-1 text-green-600">
                  <Check className="w-3 h-3" /> Synced
                </span>
              )}
              {syncState === 'error' && (
                <span className="flex items-center gap-1 text-red-500">
                  <AlertCircle className="w-3 h-3" /> Error
                </span>
              )}
              <button
                onClick={handlePush}
                disabled={syncBusy}
                title="Push to Google Doc"
                className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
              >
                <CloudUpload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handlePull}
                disabled={syncBusy}
                title="Pull from Google Doc"
                className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
              >
                <CloudDownload className="w-3.5 h-3.5" />
              </button>
            </>
          ) : linkMode === 'link-input' ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleLinkDoc();
                  if (e.key === 'Escape') setLinkMode('none');
                }}
                placeholder="Paste Google Doc URL…"
                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-48 outline-none focus:border-indigo-400"
              />
              <button
                onClick={() => void handleLinkDoc()}
                disabled={linking || !linkUrl.trim()}
                className="text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
              >
                {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
              <button onClick={() => setLinkMode('none')} className="text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleCreateDoc()}
                disabled={linking}
                className="flex items-center gap-1 text-gray-500 hover:text-indigo-600 disabled:opacity-40"
              >
                {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                Create Google Doc
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setLinkMode('link-input')}
                className="flex items-center gap-1 text-gray-500 hover:text-indigo-600"
              >
                <Link2 className="w-3 h-3" />
                Link existing
              </button>
            </div>
          )}
        </div>

        {/* Right: Save to Files */}
        <button
          onClick={() => void handleSaveToFiles()}
          disabled={saveStatus === 'saving' || !documentHtml || documentHtml === '<p></p>'}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {saveStatus === 'saved' ? (
            <Check className="w-3 h-3" />
          ) : saveStatus === 'error' ? (
            <AlertCircle className="w-3 h-3" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          {saveStatus === 'saving' ? 'Saving…'
            : saveStatus === 'saved' ? 'Saved!'
            : saveStatus === 'error' ? 'Failed'
            : 'Save to Files'}
        </button>
      </div>

      {/* Full-featured editor — flex-col + min-h-0 gives SingleDocEditor a proper height context */}
      <div className="flex flex-col flex-1 min-h-0">
        <SingleDocEditor
          documentHtml={documentHtml}
          onDocumentChange={handleDocumentChange}
          onSelectionChange={() => {}}
          onActiveSectionChange={() => {}}
        />
      </div>
    </div>
  );
}
