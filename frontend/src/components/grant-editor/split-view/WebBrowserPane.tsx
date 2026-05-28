'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Search,
  ClipboardCopy, FileInput, Loader2, AlertCircle,
  Shield, ShieldOff, ExternalLink,
} from 'lucide-react';
import { proxy, api } from '@/lib/api';

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

function resolveUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.hostname === 'duckduckgo.com' || parsed.hostname === 'www.duckduckgo.com') &&
      parsed.pathname === '/l/'
    ) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch { /* not a URL yet */ }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.includes('.') || trimmed.includes(' ')) {
    return `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(trimmed)}`;
  }
  return `https://${trimmed}`;
}

function isSearchQuery(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  return !trimmed.includes('.') || trimmed.includes(' ');
}

export default function WebBrowserPane({ onInsertText }: WebBrowserPaneProps) {
  const [mode, setMode] = useState<'proxy' | 'iframe'>('proxy');
  const [urlInput, setUrlInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // Proxy state
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyError, setProxyError] = useState('');
  const [pageHtml, setPageHtml] = useState('');
  const [pageTitle, setPageTitle] = useState('');

  // Iframe state
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [iframeMayBeBlocked, setIframeMayBeBlocked] = useState(false);
  const iframeBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [floatingBar, setFloatingBar] = useState<FloatingToolbar | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentEntry = historyIdx >= 0 ? history[historyIdx] : null;

  const navigateProxy = useCallback(async (rawUrl: string) => {
    const url = resolveUrl(rawUrl);
    if (!url) return;
    setUrlInput(url);
    setProxyLoading(true);
    setProxyError('');
    setPageHtml('');
    setFloatingBar(null);
    try {
      const res = await proxy.fetchPage(url);
      const { html, title, url: finalUrl } = res.data;
      setPageHtml(html);
      setPageTitle(title || finalUrl || url);
      setUrlInput(finalUrl || url);
      const entry: HistoryEntry = { url: finalUrl || url, title: title || finalUrl || url };
      setHistory((h) => [...h.slice(0, historyIdx + 1), entry]);
      setHistoryIdx((i) => i + 1);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ||
        (e as { message?: string }).message ||
        'Failed to load page';
      setProxyError(msg);
    } finally {
      setProxyLoading(false);
    }
  }, [historyIdx]);

  const navigateIframe = useCallback((rawUrl: string) => {
    const url = resolveUrl(rawUrl);
    if (!url) return;
    setUrlInput(url);
    setIframeLoading(true);
    setIframeMayBeBlocked(false);
    setIframeSrc(url);
    const entry: HistoryEntry = { url, title: url };
    setHistory((h) => [...h.slice(0, historyIdx + 1), entry]);
    setHistoryIdx((i) => i + 1);
    if (iframeBlockTimerRef.current) clearTimeout(iframeBlockTimerRef.current);
    iframeBlockTimerRef.current = setTimeout(() => setIframeMayBeBlocked(true), 4000);
  }, [historyIdx]);

  const navigate = useCallback((rawUrl: string) => {
    if (isSearchQuery(rawUrl) || mode === 'proxy') {
      void navigateProxy(rawUrl);
    } else {
      navigateIframe(rawUrl);
    }
  }, [mode, navigateProxy, navigateIframe]);

  const handleBack = () => {
    if (historyIdx <= 0) return;
    const prev = history[historyIdx - 1];
    setHistoryIdx((i) => i - 1);
    setUrlInput(prev.url);
    if (mode === 'iframe' && !isSearchQuery(prev.url)) navigateIframe(prev.url);
    else void navigateProxy(prev.url);
  };

  const handleForward = () => {
    if (historyIdx >= history.length - 1) return;
    const next = history[historyIdx + 1];
    if (!next) return;
    setHistoryIdx((i) => i + 1);
    setUrlInput(next.url);
    if (mode === 'iframe' && !isSearchQuery(next.url)) navigateIframe(next.url);
    else void navigateProxy(next.url);
  };

  const handleReload = () => {
    if (mode === 'iframe' && iframeSrc) {
      setIframeLoading(true);
      setIframeMayBeBlocked(false);
      const src = iframeSrc;
      setIframeSrc('');
      requestAnimationFrame(() => setIframeSrc(src));
    } else if (currentEntry) {
      void navigateProxy(currentEntry.url);
    }
  };

  const switchToProxy = () => {
    setMode('proxy');
    if (iframeSrc) void navigateProxy(iframeSrc);
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
    if (iframeBlockTimerRef.current) { clearTimeout(iframeBlockTimerRef.current); iframeBlockTimerRef.current = null; }
    setIframeMayBeBlocked(false);
  };

  useEffect(() => {
    return () => { if (iframeBlockTimerRef.current) clearTimeout(iframeBlockTimerRef.current); };
  }, []);

  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    try {
      const base = currentEntry?.url ?? 'https://example.com';
      const resolved = resolveUrl(new URL(href, base).toString());
      void navigateProxy(resolved);
    } catch {
      void navigateProxy(href);
    }
  }, [currentEntry, navigateProxy]);

  const handleMouseUp = useCallback(() => {
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

  const isLoading = mode === 'proxy' ? proxyLoading : iframeLoading;
  const isEmpty = mode === 'proxy' ? !pageHtml && !proxyLoading && !proxyError : !iframeSrc;

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
        <button onClick={handleReload} disabled={isEmpty || isLoading}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 transition-colors" title="Reload">
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
        </button>

        <div className="flex flex-1 items-center gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-0.5">
          <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(urlInput); }}
            placeholder="Search or enter a URL…"
            className="flex-1 text-xs outline-none bg-transparent text-gray-700 placeholder-gray-400"
            spellCheck={false}
          />
          <button onClick={() => navigate(urlInput)} disabled={isLoading || !urlInput.trim()}
            className="p-0.5 text-gray-400 hover:text-indigo-600 disabled:opacity-30 transition-colors" title="Go">
            <Search className="w-3 h-3" />
          </button>
        </div>

        {urlInput && (
          <a href={resolveUrl(urlInput)} target="_blank" rel="noopener noreferrer"
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="Open in new tab">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        <button
          onClick={() => {
            if (mode === 'proxy') { setMode('iframe'); if (urlInput) navigateIframe(resolveUrl(urlInput)); }
            else switchToProxy();
          }}
          title={mode === 'proxy' ? 'Switch to Direct (iframe) Mode' : 'Switch back to Proxy Mode'}
          className={`p-1 rounded transition-colors ${
            mode === 'iframe' ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
          }`}
        >
          {mode === 'iframe' ? <ShieldOff className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
        </button>
      </div>

      {mode === 'iframe' && iframeMayBeBlocked && (
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          <span>This site may block embedding — the page may not load correctly.</span>
          <button onClick={switchToProxy}
            className="text-xs font-medium px-2 py-0.5 rounded bg-amber-700 text-white hover:bg-amber-800 whitespace-nowrap">
            Switch to Proxy
          </button>
        </div>
      )}

      {/* Proxy content */}
      {mode === 'proxy' && (
        <div className="flex-1 overflow-auto relative" ref={contentRef}>
          {proxyLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-xs">Loading…</p>
            </div>
          )}
          {!proxyLoading && proxyError && (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm font-medium text-gray-700">Could not load page</p>
              <p className="text-xs text-gray-500">{proxyError}</p>
              <div className="flex gap-2">
                <button onClick={() => void navigateProxy(urlInput)}
                  className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Try again</button>
                <a href={resolveUrl(urlInput)} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Open in browser</a>
              </div>
            </div>
          )}
          {!proxyLoading && !proxyError && !pageHtml && (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center text-gray-400">
              <Globe className="w-10 h-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">Web Browser</p>
              <p className="text-xs leading-relaxed max-w-[260px]">
                Type a URL or search term above and press Enter.
                Highlight any text to insert it into your document.
              </p>
            </div>
          )}
          {!proxyLoading && !proxyError && pageHtml && (
            <>
              {pageTitle && (
                <div className="px-3 py-1 bg-gray-50 border-b border-gray-100">
                  <p className="text-[10px] text-gray-500 truncate" title={pageTitle}>{pageTitle}</p>
                </div>
              )}
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div
                className="p-4 prose prose-sm max-w-none text-gray-800 select-text [&_a]:text-blue-600 [&_a]:cursor-pointer [&_img]:max-w-full"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: pageHtml }}
                onClick={handleContentClick}
                onMouseUp={handleMouseUp}
              />
            </>
          )}

          {floatingBar && (
            <div
              data-floating-toolbar="true"
              className="absolute z-50 flex items-center gap-1 bg-gray-900 text-white rounded-lg px-2 py-1.5 shadow-lg text-xs"
              style={{ left: `${floatingBar.x}px`, top: `${floatingBar.y}px`, transform: 'translateX(-50%)' }}
            >
              <button onClick={handleInsert}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500 hover:bg-indigo-400 whitespace-nowrap">
                <FileInput className="w-3 h-3" />
                Insert into Editor
              </button>
              <button onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-700 whitespace-nowrap">
                <ClipboardCopy className="w-3 h-3" />
                {copyFeedback ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Iframe content */}
      {mode === 'iframe' && (
        <div className="flex flex-1 overflow-hidden relative">
          {isEmpty && !iframeLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-gray-400">
              <Globe className="w-10 h-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">Direct Mode</p>
              <p className="text-xs leading-relaxed max-w-[260px]">Enter a full URL. Use the shield button to return to Proxy Mode.</p>
            </div>
          )}
          {iframeLoading && iframeSrc && (
            <div className="absolute inset-x-0 top-0 h-0.5 bg-indigo-200 overflow-hidden z-10">
              <div className="h-full bg-indigo-500 animate-pulse w-1/2" />
            </div>
          )}
          {iframeSrc && (
            <iframe
              src={iframeSrc}
              className="flex-1 w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={() => { setIframeLoading(false); setIframeMayBeBlocked(true); }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer-when-downgrade"
              title="Embedded browser"
              allow="clipboard-read; clipboard-write"
            />
          )}
        </div>
      )}
    </div>
  );
}
