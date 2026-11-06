'use client';

import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor: () => void } };
  }
}

/** What the backend's `/editor` routes return. */
export interface EditorConfigResponse {
  document_server_url: string;
  config: Record<string, unknown>;
  can_edit: boolean;
  [extra: string]: unknown;
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
        reject(new Error('Could not reach the document editor server.'));
      };
      document.body.appendChild(s);
    });
    scriptLoads.set(serverUrl, p);
  }
  return p;
}

/**
 * Mount an OnlyOffice editor into the returned container. `fetchConfig` gets
 * the signed config (and the container, to size the editor to it); the editor
 * is rebuilt whenever `mountKey` changes.
 */
export function useOnlyOfficeEditor(
  fetchConfig: (container: HTMLDivElement) => Promise<EditorConfigResponse>,
  mountKey: string,
  onConfig?: (res: EditorConfigResponse) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  // Latest callbacks without re-mounting the editor when they change.
  const fetchRef = useRef(fetchConfig);
  const onConfigRef = useRef(onConfig);
  fetchRef.current = fetchConfig;
  onConfigRef.current = onConfig;

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError(null);
    (async () => {
      try {
        if (!containerRef.current) return;
        const res = await fetchRef.current(containerRef.current);
        const { document_server_url, config, can_edit } = res;
        await loadDocsApi(document_server_url);
        if (cancelled || !window.DocsAPI || !containerRef.current) return;
        setReadOnly(!can_edit);
        onConfigRef.current?.(res);
        // OnlyOffice swaps its mount node for an iframe, so React never owns it.
        const mount = document.createElement('div');
        mount.id = `oo-${mountKey.replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}`;
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
        setError(e?.response?.data?.detail || e?.message || 'Could not open the file.');
        setState('error');
      }
    })();
    const container = containerRef.current;
    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
      if (container) container.innerHTML = '';
    };
  }, [mountKey]);

  return { containerRef, state, error, readOnly };
}
