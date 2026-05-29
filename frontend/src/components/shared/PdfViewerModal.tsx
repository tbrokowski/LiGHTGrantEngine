'use client';

import { X, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useDocumentPdfBlob } from '@/hooks/useDocumentPdfBlob';
import { api } from '@/lib/api';

interface PdfViewerModalProps {
  docId: string;
  fileName?: string;
  onClose: () => void;
}

export default function PdfViewerModal({ docId, fileName, onClose }: PdfViewerModalProps) {
  const { blobUrl, loading, error } = useDocumentPdfBlob(docId);
  const label = fileName ?? 'Document';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const openInNewTab = async () => {
    try {
      const res = await api.get<{ url?: string }>(`/documents/${docId}/content`);
      if (res.data.url) {
        window.open(res.data.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      if (blobUrl) window.open(blobUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-gray-900 text-white">
        <span className="text-sm font-medium truncate max-w-[60%]">
          {label}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openInNewTab}
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in new tab
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Close viewer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 bg-gray-800">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300 px-6 text-center">
            {error}
          </div>
        )}
        {blobUrl && (
          <iframe
            src={blobUrl}
            title={label}
            className="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  );
}
