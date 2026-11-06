'use client';

import { useCallback, useEffect } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { grants } from '@/lib/api';
import { useOnlyOfficeEditor } from '@/lib/onlyoffice';

interface Props {
  grantId: string;
  sheetId: string;
  fileName: string;
  onDownload: () => void;
  downloading: boolean;
  onClose: () => void;
}

/**
 * Full-screen OnlyOffice spreadsheet editor. Everyone who opens the same
 * workbook joins one live co-editing session; saves flow back to the backend
 * through the Document Server's callback.
 */
export default function SpreadsheetEditor({ grantId, sheetId, fileName, onDownload, downloading, onClose }: Props) {
  const fetchConfig = useCallback(
    () => grants.getSpreadsheetEditor(grantId, sheetId).then(r => r.data),
    [grantId, sheetId],
  );
  const { containerRef, state, error, readOnly } = useOnlyOfficeEditor(fetchConfig, `sheet-${grantId}-${sheetId}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state === 'error') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--surface-base)' }}>
      <div
        className="flex items-center gap-3 px-4 h-11 shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-chrome)' }}
      >
        <span className="text-sm font-medium truncate" style={{ color: 'var(--ink-primary)' }}>{fileName}</span>
        {readOnly && (
          <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: 'var(--ink-muted)', background: 'var(--surface-sunken)' }}>
            View only
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Changes save for everyone automatically
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md disabled:opacity-60"
            style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Download
          </button>
          <button
            onClick={onClose}
            aria-label="Close editor"
            className="p-1.5 rounded-md"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {state !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-sm" style={{ color: 'var(--ink-muted)' }}>
            {state === 'loading' ? (
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Opening workbook…</span>
            ) : (
              <span style={{ color: 'var(--state-danger)' }}>{error}</span>
            )}
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
