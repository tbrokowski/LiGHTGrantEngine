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
import { extractDocId } from '@/lib/extractDocId';

interface PdfViewerState {
  docId: string;
  fileName?: string;
}

interface PdfViewerContextValue {
  /** Open a stored document by its document ID in a full-screen PDF viewer. */
  openPdfViewer: (docId: string, fileName?: string) => Promise<void>;
  /** Open by content URL (extracts doc id) or direct URL for non-internal files. */
  openPdfViewerUrl: (url: string, fileName?: string) => void;
}

const PdfViewerContext = createContext<PdfViewerContextValue | null>(null);

export function PdfViewerProvider({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = useState<PdfViewerState | null>(null);
  const portalRoot = useRef<HTMLElement | null>(null);

  const openPdfViewerUrl = useCallback((url: string, fileName?: string) => {
    const docId = extractDocId(url);
    if (docId) {
      setViewer({ docId, fileName });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openPdfViewer = useCallback(async (docId: string, fileName?: string) => {
    try {
      const res = await api.get<{ url?: string; text?: string; file_name?: string }>(
        `/documents/${docId}/content`
      );
      const resolvedName = res.data.file_name ?? fileName;
      const lower = (resolvedName ?? '').toLowerCase();
      const isPdf = lower.endsWith('.pdf');

      if (res.data.url && isPdf) {
        setViewer({ docId, fileName: resolvedName });
        return;
      }
      if (res.data.url) {
        window.open(res.data.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (res.data.text) {
        const blob = new Blob([res.data.text], { type: 'text/plain' });
        window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Failed to open document', docId, err);
    }
  }, []);

  if (typeof document !== 'undefined' && !portalRoot.current) {
    portalRoot.current = document.body;
  }

  return (
    <PdfViewerContext.Provider value={{ openPdfViewer, openPdfViewerUrl }}>
      {children}
      {viewer && portalRoot.current &&
        createPortal(
          <PdfViewerModal
            docId={viewer.docId}
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
