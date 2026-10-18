'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Download, FileSpreadsheet, History, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { grants } from '@/lib/api';
import SpreadsheetEditor from './SpreadsheetEditor';

interface Workbook {
  id: string;
  file_name: string;
  file_ext: 'xlsx' | 'xlsm';
  size_bytes: number;
  version: number;
  uploaded_by_name?: string | null;
  last_edited_by_name?: string | null;
  updated_at: string;
}

interface Version {
  version: number;
  size_bytes: number;
  created_by_name?: string | null;
  created_at: string;
}

function saveBlob(data: Blob, fileName: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Excel budget workbooks attached to a grant. Uploaded files are kept in their
 * original format (.xlsx or .xlsm, macros included), co-edited live in
 * OnlyOffice, and downloaded back out unchanged apart from the edits.
 */
export default function BudgetWorkbooks({ grantId, canEdit }: { grantId: string; canEdit: boolean }) {
  const [workbooks, setWorkbooks] = useState<Workbook[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    grants.listSpreadsheets(grantId)
      .then((r) => setWorkbooks(r.data))
      .catch(() => setWorkbooks([]));
  }, [grantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const res = await grants.uploadSpreadsheet(grantId, file);
      refresh();
      setOpenId(res.data.id);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(err?.response?.data?.detail || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (wb: Workbook) => {
    setDownloadingId(wb.id);
    try {
      const res = await grants.downloadSpreadsheet(grantId, wb.id);
      saveBlob(res.data, wb.file_name);
      refresh();
    } catch {
      toast.error('Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  const toggleHistory = async (wb: Workbook) => {
    if (historyId === wb.id) { setHistoryId(null); return; }
    setHistoryId(wb.id);
    setVersions(null);
    const res = await grants.listSpreadsheetVersions(grantId, wb.id).catch(() => null);
    setVersions(res?.data ?? []);
  };

  const downloadVersion = async (wb: Workbook, v: Version) => {
    try {
      const res = await grants.downloadSpreadsheetVersion(grantId, wb.id, v.version);
      const stem = wb.file_name.replace(/\.[^.]+$/, '');
      saveBlob(res.data, `${stem} (v${v.version}).${wb.file_ext}`);
    } catch {
      toast.error('Download failed.');
    }
  };

  const handleDelete = async (wb: Workbook) => {
    if (!window.confirm(`Delete "${wb.file_name}" and all of its saved versions?`)) return;
    try {
      await grants.deleteSpreadsheet(grantId, wb.id);
      refresh();
    } catch {
      toast.error('Could not delete the workbook.');
    }
  };

  const open = workbooks?.find((w) => w.id === openId);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Budget workbooks</h3>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Excel files (.xlsx, .xlsm) edited together in the browser. Formatting, formulas and macros are kept.
          </p>
        </div>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleUpload} />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md disabled:opacity-60"
              style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Upload workbook
            </button>
          </>
        )}
      </div>

      {workbooks === null ? (
        <p className="text-xs py-3" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
      ) : workbooks.length === 0 ? (
        <p className="text-xs py-3" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-faint)' }}>
          No workbooks yet{canEdit ? ' — upload your budget spreadsheet to start editing it with the team.' : '.'}
        </p>
      ) : (
        <div>
          {workbooks.map((wb) => (
            <div key={wb.id} style={{ borderTop: '1px solid var(--rule-subtle)' }}>
              <div className="flex items-center gap-3 py-2.5">
                <FileSpreadsheet size={16} style={{ color: 'var(--state-success)' }} className="shrink-0" />
                <button onClick={() => setOpenId(wb.id)} className="min-w-0 text-left flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{wb.file_name}</span>
                    {wb.file_ext === 'xlsm' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ color: 'var(--state-info)', background: 'var(--state-info-bg)' }}>
                        macros
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                    v{wb.version} · {fmtSize(wb.size_bytes)} · edited {formatDistanceToNow(new Date(wb.updated_at), { addSuffix: true })}
                    {wb.last_edited_by_name ? ` by ${wb.last_edited_by_name}` : ''}
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0" style={{ color: 'var(--ink-secondary)' }}>
                  <button
                    onClick={() => setOpenId(wb.id)}
                    className="text-xs px-2.5 py-1 rounded-md"
                    style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
                  >
                    {canEdit ? 'Edit' : 'View'}
                  </button>
                  <button onClick={() => handleDownload(wb)} disabled={downloadingId === wb.id} className="p-1.5 rounded-md" aria-label="Download" title="Download">
                    {downloadingId === wb.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  </button>
                  <button onClick={() => toggleHistory(wb)} className="p-1.5 rounded-md" aria-label="Version history" title="Version history">
                    <History size={14} />
                  </button>
                  {canEdit && (
                    <button onClick={() => handleDelete(wb)} className="p-1.5 rounded-md" aria-label="Delete" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {historyId === wb.id && (
                <div className="pl-7 pb-2">
                  {versions === null ? (
                    <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>Loading versions…</p>
                  ) : (
                    versions.map((v) => (
                      <div key={v.version} className="flex items-center gap-3 py-1 text-xs font-mono tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                        <span className="w-8">v{v.version}</span>
                        <span className="flex-1 truncate font-sans">
                          {new Date(v.created_at).toLocaleString()}{v.created_by_name ? ` · ${v.created_by_name}` : ''}
                          {v.version === 1 ? ' · original upload' : ''}
                        </span>
                        <span>{fmtSize(v.size_bytes)}</span>
                        <button onClick={() => downloadVersion(wb, v)} className="p-1" aria-label={`Download v${v.version}`}>
                          <Download size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <SpreadsheetEditor
          grantId={grantId}
          sheetId={open.id}
          fileName={open.file_name}
          downloading={downloadingId === open.id}
          onDownload={() => handleDownload(open)}
          onClose={() => {
            setOpenId(null);
            // The Document Server saves a few seconds after the last editor leaves.
            setTimeout(refresh, 12000);
            refresh();
          }}
        />
      )}
    </section>
  );
}
