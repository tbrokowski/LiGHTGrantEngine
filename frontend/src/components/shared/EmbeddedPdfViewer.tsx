'use client';

import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { useDocumentPdfBlob } from '@/hooks/useDocumentPdfBlob';
import { api } from '@/lib/api';

interface EmbeddedPdfViewerProps {
  docId: string;
  fileName?: string;
  className?: string;
}

export default function EmbeddedPdfViewer({ docId, fileName, className = '' }: EmbeddedPdfViewerProps) {
  const { blobUrl, loading, error } = useDocumentPdfBlob(docId);
  const label = fileName ?? 'Document';

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

  return (
    <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${className}`}>
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
        <span className="truncate max-w-[300px]">{label}</span>
        <button
          type="button"
          onClick={openInNewTab}
          className="flex items-center gap-1 text-indigo-600 hover:underline flex-shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          Open / Download
        </button>
      </div>
      <div className="relative flex-1 min-h-0 bg-gray-100">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading PDF…
          </div>
        )}
        {blobUrl && (
          <iframe
            src={blobUrl}
            className="w-full h-full border-0"
            title={label}
          />
        )}
      </div>
    </div>
  );
}
