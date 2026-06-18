'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  ExternalLink, Loader2, AlertCircle, Maximize2,
} from 'lucide-react';
import { useDocumentPdfBlob } from '@/hooks/useDocumentPdfBlob';
import { api } from '@/lib/api';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.25;
const ZOOM_DEFAULT = 1.0;

interface EmbeddedPdfViewerProps {
  docId: string;
  fileName?: string;
  className?: string;
}

export default function EmbeddedPdfViewer({ docId, fileName, className = '' }: EmbeddedPdfViewerProps) {
  const { blobUrl, loading, error } = useDocumentPdfBlob(docId);
  const label = fileName ?? 'Document';

  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(ZOOM_DEFAULT);
  const [pageInputValue, setPageInputValue] = useState('1');
  const [fitWidth, setFitWidth] = useState(false);
  const [containerWidth, setContainerWidth] = useState(640);

  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track container width for fit-to-width mode
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(Math.floor(w) - 2);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPageNumber(1);
    setPageInputValue('1');
  }, []);

  // Zoom helpers — snap to nearest 0.25 step
  const zoomIn = useCallback(() =>
    setScale(s => Math.min(ZOOM_MAX, Math.round((s + ZOOM_STEP) * 100) / 100)), []);
  const zoomOut = useCallback(() =>
    setScale(s => Math.max(ZOOM_MIN, Math.round((s - ZOOM_STEP) * 100) / 100)), []);
  const resetZoom = useCallback(() => { setScale(ZOOM_DEFAULT); setFitWidth(false); }, []);

  const handleFitWidth = useCallback(() => {
    setFitWidth(fw => !fw);
    setScale(ZOOM_DEFAULT);
  }, []);

  const handleZoomIn = useCallback(() => { setFitWidth(false); zoomIn(); }, [zoomIn]);
  const handleZoomOut = useCallback(() => { setFitWidth(false); zoomOut(); }, [zoomOut]);

  // Page navigation
  const prevPage = () => {
    const p = Math.max(1, pageNumber - 1);
    setPageNumber(p);
    setPageInputValue(String(p));
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const nextPage = () => {
    const p = Math.min(numPages, pageNumber + 1);
    setPageNumber(p);
    setPageInputValue(String(p));
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) =>
    setPageInputValue(e.target.value);

  const commitPageInput = () => {
    const n = parseInt(pageInputValue, 10);
    if (!isNaN(n) && n >= 1 && n <= numPages) {
      setPageNumber(n);
      scrollRef.current?.scrollTo({ top: 0 });
    } else {
      setPageInputValue(String(pageNumber));
    }
  };

  // Open in new tab
  const openInNewTab = async () => {
    try {
      const res = await api.get<{ url?: string }>(`/documents/${docId}/content`);
      if (res.data.url) {
        window.open(res.data.url, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch { /* fall through */ }
    if (blobUrl) window.open(blobUrl, '_blank', 'noopener,noreferrer');
  };

  // Keyboard zoom: Cmd/Ctrl +/−
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoomIn(); }
      if (e.key === '-') { e.preventDefault(); handleZoomOut(); }
      if (e.key === '0') { e.preventDefault(); resetZoom(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleZoomIn, handleZoomOut, resetZoom]);

  // ── Error state ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center flex-1 gap-4 text-center px-6 ${className}`}>
        <AlertCircle className="w-10 h-10 text-red-300" />
        <p className="text-sm text-gray-500">{error}</p>
        <button
          type="button"
          onClick={openInNewTab}
          className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Try opening in new tab
        </button>
      </div>
    );
  }

  const pct = Math.round(scale * 100);

  return (
    <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${className}`}>

      {/* ── Top bar: file name + open button ──────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
        <span className="truncate max-w-[260px] font-medium">{label}</span>
        <button
          type="button"
          onClick={openInNewTab}
          className="flex items-center gap-1 text-indigo-600 hover:underline flex-shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          Open / Download
        </button>
      </div>

      {/* ── Controls bar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-3 py-1 bg-white border-b border-gray-100 text-xs select-none">

        {/* Page navigation */}
        <button
          onClick={prevPage}
          disabled={pageNumber <= 1}
          title="Previous page"
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-600"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1 text-gray-600">
          <input
            type="text"
            value={pageInputValue}
            onChange={handlePageInput}
            onBlur={commitPageInput}
            onKeyDown={e => e.key === 'Enter' && commitPageInput()}
            className="w-8 text-center border border-gray-200 rounded text-xs py-0.5 focus:outline-none focus:border-indigo-400"
          />
          <span className="text-gray-400">/ {numPages || '—'}</span>
        </div>

        <button
          onClick={nextPage}
          disabled={pageNumber >= numPages}
          title="Next page"
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-600"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        {/* Zoom controls */}
        <button
          onClick={handleZoomOut}
          disabled={scale <= ZOOM_MIN}
          title="Zoom out (⌘−)"
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-600"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={resetZoom}
          title="Reset zoom (⌘0)"
          className="min-w-[44px] text-center px-1 py-0.5 rounded hover:bg-gray-100 text-gray-600 font-mono tabular-nums"
        >
          {pct}%
        </button>

        <button
          onClick={handleZoomIn}
          disabled={scale >= ZOOM_MAX}
          title="Zoom in (⌘+)"
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-600"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        {/* Fit to width */}
        <button
          onClick={handleFitWidth}
          title="Fit to width"
          className={`p-1 rounded text-gray-600 ${fitWidth ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100'}`}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── PDF content ───────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-gray-200"
      >
        <div
          ref={containerRef}
          className="flex justify-center py-4 px-2 min-h-full"
        >
          {loading && (
            <div className="flex items-center justify-center w-full text-sm text-gray-400 gap-2 py-16">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading PDF…
            </div>
          )}

          {blobUrl && (
            <Document
              file={blobUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex items-center justify-center text-sm text-gray-400 gap-2 py-16">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading PDF…
                </div>
              }
              error={
                <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
                  <AlertCircle className="w-8 h-8 text-red-300" />
                  <p className="text-sm text-gray-500">Failed to load PDF.</p>
                </div>
              }
            >
              <Page
                pageNumber={pageNumber}
                {...(fitWidth ? { width: containerWidth } : { scale })}
                renderTextLayer
                renderAnnotationLayer
                className="shadow-lg"
              />
            </Document>
          )}
        </div>
      </div>
    </div>
  );
}
