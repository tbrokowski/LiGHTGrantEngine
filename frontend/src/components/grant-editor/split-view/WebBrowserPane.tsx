'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Search,
  Loader2, AlertCircle, ExternalLink,
} from 'lucide-react';
import { browserSession } from '@/lib/api';

interface WebBrowserPaneProps {
  onInsertText: (text: string) => void;
}

function resolveUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.includes('.') || trimmed.includes(' ')) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
  return `https://${trimmed}`;
}

export default function WebBrowserPane({ onInsertText: _onInsertText }: WebBrowserPaneProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [debugUrl, setDebugUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [navigating, setNavigating] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const sessionIdRef = useRef<string | null>(null);
  const iframeKey = useRef(0);
  const [iframeKeyState, setIframeKeyState] = useState(0);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await browserSession.create();
      const { session_id, debug_url } = res.data;
      setSessionId(session_id);
      sessionIdRef.current = session_id;
      setDebugUrl(debug_url);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ||
        (e as { message?: string }).message ||
        'Could not connect to Steel Browser — is it running?';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void startSession();
    return () => {
      const id = sessionIdRef.current;
      if (id) {
        // Fire-and-forget cleanup on unmount
        navigator.sendBeacon(`/api/v1/browser/session/${id}`, '');
        browserSession.release(id).catch(() => {});
      }
    };
  }, [startSession]);

  const navigate = useCallback(async (rawUrl: string) => {
    if (!sessionId || !rawUrl.trim()) return;
    const url = resolveUrl(rawUrl);
    if (!url) return;
    setUrlInput(url);
    setNavigating(true);
    try {
      await browserSession.navigate(sessionId, url);
      setHistory((h) => [...h.slice(0, historyIdx + 1), url]);
      setHistoryIdx((i) => i + 1);
    } catch {
      // Navigation errors are visible in the streamed browser itself
    } finally {
      setNavigating(false);
    }
  }, [sessionId, historyIdx]);

  const handleBack = () => {
    if (historyIdx <= 0 || !sessionId) return;
    const prev = history[historyIdx - 1];
    setHistoryIdx((i) => i - 1);
    setUrlInput(prev);
    void browserSession.navigate(sessionId, prev).catch(() => {});
  };

  const handleForward = () => {
    if (historyIdx >= history.length - 1 || !sessionId) return;
    const next = history[historyIdx + 1];
    setHistoryIdx((i) => i + 1);
    setUrlInput(next);
    void browserSession.navigate(sessionId, next).catch(() => {});
  };

  const handleReload = () => {
    if (!sessionId) return;
    iframeKey.current += 1;
    setIframeKeyState(iframeKey.current);
  };

  const handleRetry = () => {
    void startSession();
  };

  const isLoading = loading || navigating;

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-white">
      {/* Browser chrome */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <button
          onClick={handleBack}
          disabled={historyIdx <= 0 || !sessionId}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleForward}
          disabled={historyIdx >= history.length - 1 || !sessionId}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors"
          title="Forward"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleReload}
          disabled={!sessionId || loading}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors"
          title="Reload"
        >
          {isLoading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RotateCw className="w-3.5 h-3.5" />}
        </button>

        {/* URL / search bar */}
        <div className="flex flex-1 items-center gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-0.5">
          <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void navigate(urlInput); }}
            placeholder="Search or enter a URL…"
            className="flex-1 text-xs outline-none bg-transparent text-gray-700 placeholder-gray-400"
            spellCheck={false}
            disabled={!sessionId}
          />
          <button
            onClick={() => void navigate(urlInput)}
            disabled={!sessionId || !urlInput.trim() || navigating}
            className="p-0.5 text-gray-400 hover:text-indigo-600 disabled:opacity-30 transition-colors"
            title="Go"
          >
            <Search className="w-3 h-3" />
          </button>
        </div>

        {urlInput && (
          <a
            href={resolveUrl(urlInput)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Session starting */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white text-gray-400 z-10">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs">Starting browser session…</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center z-10">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-medium text-gray-700">Could not start browser</p>
            <p className="text-xs text-gray-500 max-w-xs">{error}</p>
            <button
              onClick={handleRetry}
              className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* Live Steel browser stream */}
        {!loading && !error && debugUrl && (
          <iframe
            key={iframeKeyState}
            src={`${debugUrl}?interactive=true&showControls=false&theme=light`}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            allow="clipboard-read; clipboard-write; microphone; camera"
            title="Live browser"
          />
        )}
      </div>
    </div>
  );
}
