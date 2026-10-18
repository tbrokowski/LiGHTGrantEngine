'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { grants } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor: () => void } };
  }
}

// One script load per Document Server origin, shared across editor mounts.
const scriptLoads = new Map<string, Promise<void>>();

function loadDocsApi(serverUrl: string): Promise<void> {
  if (window.DocsAPI) return Promise.resolve();
  let p = scriptLoads.get(serverUrl);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${serverUrl}/web-apps/apps/api/documents/api.js`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptLoads.delete(serverUrl);
        s.remove();
        reject(new Error('Could not reach the spreadsheet editor server.'));
      };
      document.body.appendChild(s);
    });
    scriptLoads.set(serverUrl, p);
  }
  return p;
}

interface Props {
  grantId: string;
  sheetId: string;
  fileName: string;
  onDownload: () => void;
  downloading: boolean;
  onClose: () => void;
}

/**
 * Full-screen OnlyOffice spreadsheet editor. Everyone who opens the same
 * workbook joins one live co-editing session; saves flow back to the backend
 * through the Document Server's callback.
 */
export default function SpreadsheetEditor({ grantId, sheetId, fileName, onDownload, downloading, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await grants.getSpreadsheetEditor(grantId, sheetId);
        const { document_server_url, config, can_edit } = res.data;
        await loadDocsApi(document_server_url);
        if (cancelled || !window.DocsAPI || !containerRef.current) return;
        setReadOnly(!can_edit);
        // OnlyOffice swaps its mount node for an iframe, so React never owns it.
        const mount = document.createElement('div');
        mount.id = `oo-sheet-${sheetId}-${Date.now()}`;
        containerRef.current.appendChild(mount);
        editorRef.current = new window.DocsAPI.DocEditor(mount.id, {
          ...config,
          width: '100%',
          height: '100%',
          type: 'desktop',
          events: {
            onAppReady: () => !cancelled && setState('ready'),
            onError: (e: any) => {
              if (cancelled) return;
              setError(e?.data?.errorDescription || 'The editor reported an error.');
              setState('error');
            },
          },
        });
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.detail || e?.message || 'Could not open the workbook.');
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [grantId, sheetId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state === 'error') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--surface-base)' }}>
      <div
        className="flex items-center gap-3 px-4 h-11 shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-chrome)' }}
      >
        <span className="text-sm font-medium truncate" style={{ color: 'var(--ink-primary)' }}>{fileName}</span>
        {readOnly && (
          <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: 'var(--ink-muted)', background: 'var(--surface-sunken)' }}>
            View only
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Changes save for everyone automatically
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md disabled:opacity-60"
            style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Download
          </button>
          <button
            onClick={onClose}
            aria-label="Close editor"
            className="p-1.5 rounded-md"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {state !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-sm" style={{ color: 'var(--ink-muted)' }}>
            {state === 'loading' ? (
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Opening workbook…</span>
            ) : (
              <span style={{ color: 'var(--state-danger)' }}>{error}</span>
            )}
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
