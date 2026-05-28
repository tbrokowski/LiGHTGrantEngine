'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Search,
  ClipboardCopy, FileInput, Loader2, AlertCircle,
} from 'lucide-react';
import { proxy } from '@/lib/api';

interface WebBrowserPaneProps {
  onInsertText: (text: string) => void;
}

interface HistoryEntry {
  url: string;
  title: string;
}

interface FloatingToolbar {
  x: number;
  y: number;
  text: string;
}

/** Unwrap DuckDuckGo tracking redirects on the frontend as a backup safety net. */
function unwrapDdgHref(href: string): string {
  try {
    const parsed = new URL(href);
    if (
      (parsed.hostname === 'duckduckgo.com' || parsed.hostname === 'www.duckduckgo.com') &&
      parsed.pathname === '/l/'
    ) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch { /* ignore */ }
  return href;
}

export default function WebBrowserPane({ onInsertText }: WebBrowserPaneProps) {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageHtml, setPageHtml] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [floatingBar, setFloatingBar] = useState<FloatingToolbar | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);

  const currentEntry = historyIdx >= 0 ? history[historyIdx] : null;

  const navigate = useCallback(async (rawUrl: string) => {
    let url = rawUrl.trim();
    if (!url) return;

    // First, unwrap any DDG tracking redirect that slipped through
    url = unwrapDdgHref(url);

    // Auto-prepend scheme
    if (!/^https?:\/\//i.test(url)) {
      // Looks like a search query → use DuckDuckGo Lite (static HTML, no JS)
      if (!url.includes('.') || url.includes(' ')) {
        url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(url)}`;
      } else {
        url = `https://${url}`;
      }
    }

    setUrlInput(url);
    setLoading(true);
    setError('');
    setPageHtml('');
    setFloatingBar(null);

    try {
      const res = await proxy.fetchPage(url);
      const { html, title, url: finalUrl } = res.data;
      setPageHtml(html);
      setPageTitle(title || finalUrl);
      // Update URL bar to reflect any server-side redirects
      setUrlInput(finalUrl || url);

      const entry: HistoryEntry = { url: finalUrl || url, title: title || finalUrl };
      setHistory((h) => {
        const trimmed = h.slice(0, historyIdx + 1);
        return [...trimmed, entry];
      });
      setHistoryIdx((i) => i + 1);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ||
        (e as { message?: string }).message ||
        'Failed to load page';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [historyIdx]);

  const handleBack = () => {
    if (historyIdx <= 0) return;
    const prev = history[historyIdx - 1];
    setHistoryIdx((i) => i - 1);
    setUrlInput(prev.url);
    setPageTitle(prev.title);
    void navigate(prev.url);
  };

  const handleForward = () => {
    if (historyIdx >= history.length - 1) return;
    const next = history[historyIdx + 1];
    if (!next) return;
    setHistoryIdx((i) => i + 1);
    setUrlInput(next.url);
    void navigate(next.url);
  };

  const handleReload = () => {
    if (currentEntry) void navigate(currentEntry.url);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void navigate(urlInput);
  };

  // Intercept link clicks — unwrap DDG redirects before proxying
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    try {
      const base = currentEntry?.url ?? 'https://example.com';
      let resolved = new URL(href, base).toString();
      // Unwrap any DDG tracking redirect
      resolved = unwrapDdgHref(resolved);
      void navigate(resolved);
    } catch {
      void navigate(href);
    }
  }, [currentEntry, navigate]);

  // Floating selection toolbar
  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) { setFloatingBar(null); return; }
    const range = sel!.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const paneRect = contentRef.current?.getBoundingClientRect();
    if (!paneRect) return;
    setFloatingBar({
      x: rect.left - paneRect.left + rect.width / 2,
      y: rect.top - paneRect.top - 44,
      text,
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-floating-toolbar]') && !contentRef.current?.contains(t)) {
        setFloatingBar(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInsert = () => {
    if (!floatingBar) return;
    onInsertText(floatingBar.text);
    setFloatingBar(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleCopy = () => {
    if (!floatingBar) return;
    navigator.clipboard.writeText(floatingBar.text).catch(() => {});
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-white">
      {/* Browser chrome */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <button onClick={handleBack} disabled={historyIdx <= 0}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors" title="Back">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleForward} disabled={historyIdx >= history.length - 1}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors" title="Forward">
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleReload} disabled={!currentEntry || loading}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors" title="Reload">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
        </button>

        {/* URL / search bar */}
        <div className="flex flex-1 items-center gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-0.5">
          <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or enter a URL…"
            className="flex-1 text-xs outline-none bg-transparent text-gray-700 placeholder-gray-400"
            spellCheck={false}
          />
          <button
            onClick={() => void navigate(urlInput)}
            disabled={loading || !urlInput.trim()}
            className="p-0.5 text-gray-400 hover:text-indigo-600 disabled:opacity-30 transition-colors"
            title="Go"
          >
            <Search className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Page title */}
      {pageTitle && !error && (
        <div className="flex-shrink-0 px-3 py-1 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-500 truncate" title={pageTitle}>{pageTitle}</p>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto relative" ref={contentRef}>
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs">Loading page…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-medium text-gray-700">Could not load page</p>
            <p className="text-xs text-gray-500">{error}</p>
            <button
              onClick={() => void navigate(urlInput)}
              className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && !pageHtml && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center text-gray-400">
            <Globe className="w-10 h-10 text-gray-300" />
            <p className="text-sm font-medium text-gray-500">Web Browser</p>
            <p className="text-xs leading-relaxed">
              Type a URL or search term above. Highlight any text on the page to insert it into your document.
            </p>
          </div>
        )}

        {!loading && !error && pageHtml && (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            className="p-4 prose prose-sm max-w-none text-gray-800 select-text [&_a]:text-blue-600 [&_a]:cursor-pointer [&_img]:max-w-full"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: pageHtml }}
            onClick={handleContentClick}
            onMouseUp={handleMouseUp}
          />
        )}

        {/* Floating selection toolbar */}
        {floatingBar && (
          <div
            data-floating-toolbar="true"
            className="absolute z-50 flex items-center gap-1 bg-gray-900 text-white rounded-lg px-2 py-1.5 shadow-lg text-xs pointer-events-auto"
            style={{ left: `${floatingBar.x}px`, top: `${floatingBar.y}px`, transform: 'translateX(-50%)' }}
          >
            <button
              onClick={handleInsert}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500 hover:bg-indigo-400 transition-colors whitespace-nowrap"
            >
              <FileInput className="w-3 h-3" />
              Insert into Editor
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              <ClipboardCopy className="w-3 h-3" />
              {copyFeedback ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
