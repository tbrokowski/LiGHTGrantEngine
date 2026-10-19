'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Download, FilePlus2, FileSpreadsheet, History, Loader2, Pencil, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { grants } from '@/lib/api';
import SpreadsheetEditor from './SpreadsheetEditor';

export interface Workbook {
  id: string;
  folder_id: string | null;
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

/** Download the current workbook (live edits are saved first by the backend). */
export async function downloadWorkbook(grantId: string, wb: Pick<Workbook, 'id' | 'file_name'>) {
  const res = await grants.downloadSpreadsheet(grantId, wb.id);
  saveBlob(res.data, wb.file_name);
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function nextBlankName(existing: Workbook[]) {
  const taken = new Set(existing.map((w) => w.file_name.toLowerCase()));
  if (!taken.has('budget.xlsx')) return 'Budget';
  let n = 2;
  while (taken.has(`budget ${n}.xlsx`)) n += 1;
  return `Budget ${n}`;
}

/**
 * The grant's Budget tab: start a blank budget spreadsheet or upload an Excel
 * workbook (.xlsx / .xlsm), then edit it together in OnlyOffice. Uploaded
 * files keep their formatting, formulas and macros.
 */
export default function BudgetWorkbooks({ grantId, canEdit }: { grantId: string; canEdit: boolean }) {
  const [workbooks, setWorkbooks] = useState<Workbook[] | null>(null);
  const [busy, setBusy] = useState<'upload' | 'blank' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
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
    setBusy('upload');
    try {
      const res = await grants.uploadSpreadsheet(grantId, file);
      if (res.data.protection_removed) {
        toast.success('Sheet protection removed so the team can edit. The original file is kept as version 1.');
      }
      refresh();
      setOpenId(res.data.id);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(err?.response?.data?.detail || 'Upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleBlank = async () => {
    setBusy('blank');
    try {
      const res = await grants.createBlankSpreadsheet(grantId, { name: nextBlankName(workbooks ?? []) });
      refresh();
      setOpenId(res.data.id);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(err?.response?.data?.detail || 'Could not create the spreadsheet.');
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async (wb: Workbook) => {
    setDownloadingId(wb.id);
    try {
      await downloadWorkbook(grantId, wb);
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

  const startRename = (wb: Workbook) => {
    setRenamingId(wb.id);
    setRenameDraft(wb.file_name.replace(/\.[^.]+$/, ''));
  };

  const saveRename = async (wb: Workbook) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name || `${name}.${wb.file_ext}` === wb.file_name) return;
    try {
      await grants.updateSpreadsheet(grantId, wb.id, { file_name: name });
      refresh();
    } catch {
      toast.error('Could not rename the workbook.');
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
  const hiddenInput = (
    <input ref={inputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleUpload} />
  );

  return (
    <section className="max-w-4xl">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Budget</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Build the budget in a shared spreadsheet. Everyone on the grant edits it together, and it downloads as Excel.
          </p>
        </div>
        {canEdit && !!workbooks?.length && (
          <div className="flex items-center gap-2 shrink-0">
            {hiddenInput}
            <button
              onClick={handleBlank}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md disabled:opacity-60"
              style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
            >
              {busy === 'blank' ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
              New blank
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md disabled:opacity-60"
              style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
            >
              {busy === 'upload' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Upload workbook
            </button>
          </div>
        )}
      </div>

      {workbooks === null ? (
        <p className="text-xs py-3" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
      ) : workbooks.length === 0 ? (
        canEdit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {hiddenInput}
            <ChoiceCard
              icon={busy === 'blank' ? <Loader2 size={18} className="animate-spin" /> : <FilePlus2 size={18} />}
              title="Start a blank budget"
              body="Open an empty spreadsheet and build the budget with your team."
              disabled={!!busy}
              onClick={handleBlank}
            />
            <ChoiceCard
              icon={busy === 'upload' ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
              title="Upload an Excel workbook"
              body="Use your own file or a funder's template (.xlsx or .xlsm). Formatting, formulas and macros are kept."
              disabled={!!busy}
              onClick={() => inputRef.current?.click()}
            />
          </div>
        ) : (
          <p className="text-xs py-3" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-faint)' }}>
            No budget yet.
          </p>
        )
      ) : (
        <div style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          {workbooks.map((wb) => (
            <div key={wb.id} style={{ borderTop: '1px solid var(--rule-subtle)' }}>
              <div className="flex items-center gap-3 py-2.5">
                <FileSpreadsheet size={16} style={{ color: 'var(--state-success)' }} className="shrink-0" />
                {renamingId === wb.id ? (
                  <form
                    className="flex-1 min-w-0 flex items-center gap-1"
                    onSubmit={(e) => { e.preventDefault(); saveRename(wb); }}
                  >
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => saveRename(wb)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
                      className="flex-1 min-w-0 text-sm px-2 py-1 rounded-md"
                      style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-primary)', background: 'var(--surface-base)' }}
                    />
                    <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>.{wb.file_ext}</span>
                  </form>
                ) : (
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
                )}
                <div className="flex items-center gap-1 shrink-0" style={{ color: 'var(--ink-secondary)' }}>
                  <button
                    onClick={() => setOpenId(wb.id)}
                    className="text-xs px-2.5 py-1 rounded-md"
                    style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
                  >
                    {canEdit ? 'Edit' : 'View'}
                  </button>
                  {canEdit && (
                    <button onClick={() => startRename(wb)} className="p-1.5 rounded-md" aria-label="Rename" title="Rename">
                      <Pencil size={14} />
                    </button>
                  )}
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
                          {v.version === 1 ? ' · original' : ''}
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

function ChoiceCard({
  icon, title, body, disabled, onClick,
}: { icon: React.ReactNode; title: string; body: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-left p-4 rounded-[10px] transition-colors disabled:opacity-60 hover:bg-[var(--surface-raised)]"
      style={{ border: '1px solid var(--rule-strong)', background: 'var(--surface-card)' }}
    >
      <span className="inline-flex w-8 h-8 items-center justify-center rounded-md mb-3" style={{ background: 'var(--surface-sunken)', color: 'var(--accent-primary)' }}>
        {icon}
      </span>
      <div className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>{title}</div>
      <div className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>{body}</div>
    </button>
  );
}
