'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import PdfViewerModal from '@/components/shared/PdfViewerModal';
import { api } from '@/lib/api';

interface PdfViewerState {
  url: string;
  fileName?: string;
}

interface PdfViewerContextValue {
  /** Open a stored document by its document ID. Fetches the presigned URL,
   *  then shows the PDF in a full-screen modal. Falls back to window.open for
   *  non-PDF files (DOCX, etc.). */
  openPdfViewer: (docId: string, fileName?: string) => Promise<void>;
  /** Open a direct URL (presigned or otherwise) directly in the viewer. */
  openPdfViewerUrl: (url: string, fileName?: string) => void;
}

const PdfViewerContext = createContext<PdfViewerContextValue | null>(null);

export function PdfViewerProvider({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = useState<PdfViewerState | null>(null);
  const portalRoot = useRef<HTMLElement | null>(null);

  const openPdfViewerUrl = useCallback((url: string, fileName?: string) => {
    setViewer({ url, fileName });
  }, []);

  const openPdfViewer = useCallback(async (docId: string, fileName?: string) => {
    try {
      const res = await api.get<{ url?: string; text?: string; file_name?: string }>(
        `/documents/${docId}/content`
      );
      const { url, file_name } = res.data;
      const resolvedName = file_name ?? fileName;

      if (url) {
        const lower = (resolvedName ?? url).toLowerCase();
        const isPdf = lower.endsWith('.pdf') || lower.includes('.pdf?');
        if (isPdf) {
          setViewer({ url, fileName: resolvedName });
          return;
        }
        // Non-PDF: open in new tab (DOCX, etc.)
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      // Text-only fallback
      if (res.data.text) {
        const blob = new Blob([res.data.text], { type: 'text/plain' });
        window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Failed to open document', docId, err);
    }
  }, []);

  // Ensure we have a valid DOM node for the portal (avoids SSR issues)
  if (typeof document !== 'undefined' && !portalRoot.current) {
    portalRoot.current = document.body;
  }

  return (
    <PdfViewerContext.Provider value={{ openPdfViewer, openPdfViewerUrl }}>
      {children}
      {viewer && portalRoot.current &&
        createPortal(
          <PdfViewerModal
            url={viewer.url}
            fileName={viewer.fileName}
            onClose={() => setViewer(null)}
          />,
          portalRoot.current
        )
      }
    </PdfViewerContext.Provider>
  );
}

export function usePdfViewer(): PdfViewerContextValue {
  const ctx = useContext(PdfViewerContext);
  if (!ctx) {
    throw new Error('usePdfViewer must be used inside <PdfViewerProvider>');
  }
  return ctx;
}
