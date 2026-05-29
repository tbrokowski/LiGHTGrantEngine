'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export function useDocumentPdfBlob(docId: string | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!docId) {
      setBlobUrl(null);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    setBlobUrl(null);
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }

    api
      .get(`/documents/${docId}/stream`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const blob = res.data instanceof Blob
          ? res.data
          : new Blob([res.data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load PDF — it may have been deleted or moved.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [docId]);

  return { blobUrl, loading, error };
}
