'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { grants } from '@/lib/api';
import { useOnlyOfficeEditor, type EditorConfigResponse } from '@/lib/onlyoffice';

type SyncState = 'none' | 'synced' | 'app_newer' | 'google_newer' | 'conflict' | 'unavailable';

interface GoogleCopy {
  url: string;
  owner_name?: string | null;
  synced_at?: string | null;
  state: SyncState;
  remote_modified_at?: string | null;
  remote_modified_by?: string | null;
  problem?: string | null;
}

interface WordDocStatus {
  id: string;
  file_name: string;
  version: number;
  can_edit: boolean;
  google: GoogleCopy | null;
  google_connected: boolean;
}

interface Props {
  grantId: string;
  /** The Word file's Document id. */
  docId: string;
  fileName: string;
  /** `inline` is a main-editor tab; `panel` fills a split-screen panel beside it. */
  variant: 'inline' | 'panel';
}

function errorDetail(err: unknown): unknown {
  return (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
}

function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function when(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function GoogleDocsIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      <path d="M4 1.5h5.5L13 5v9a.5.5 0 01-.5.5h-8.5A.5.5 0 013.5 14V2a.5.5 0 01.5-.5z" strokeLinejoin="round" />
      <path d="M9.5 1.5V5H13M5.75 8h4.5M5.75 10.25h4.5M5.75 12.5h2.75" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A .docx opened in the OnlyOffice Document Server: formatting stays exactly
 * as in Word, everyone who opens it edits together, and every save goes back
 * to the grant's file. "Open in Google Docs" works on a linked Google Doc
 * copy; the app's file stays the source of truth (see grant_word_docs.py).
 */
export default function WordDocEditor({ grantId, docId, fileName, variant }: Props) {
  const [status, setStatus] = useState<WordDocStatus | null>(null);
  const [mountCount, setMountCount] = useState(0);
  const [busy, setBusy] = useState<'google' | 'resolve' | 'download' | null>(null);

  const refreshStatus = useCallback(() => {
    grants.getWordDoc(grantId, docId).then(r => setStatus(r.data)).catch(() => {});
  }, [grantId, docId]);

  const fetchConfig = useCallback(
    // Narrower than a Word page (a split-view panel, or the main column with
    // panels open): zoom to fit the width so nothing is cut off.
    (container: HTMLDivElement) => grants.getWordDocEditor(grantId, docId, container.clientWidth < 900)
      .then(r => r.data as EditorConfigResponse),
    [grantId, docId],
  );
  const onConfig = useCallback((res: EditorConfigResponse) => {
    if (res.pulled_from_google) toast.success('Brought in the latest edits from Google Docs.');
    refreshStatus();
  }, [refreshStatus]);
  const { containerRef, state, error, readOnly } = useOnlyOfficeEditor(
    fetchConfig, `word-${docId}-${mountCount}`, onConfig,
  );

  // Coming back from the Google Docs tab: check whether it was edited there.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, 60000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [refreshStatus]);

  const openInGoogle = async () => {
    // Open the tab inside the click so popup blockers allow it; point it at
    // the doc once the backend has it ready.
    const win = window.open('about:blank', '_blank');
    setBusy('google');
    try {
      const { data } = await grants.openWordDocInGoogle(grantId, docId);
      if (win) { win.opener = null; win.location.href = data.url; }
      else window.open(data.url, '_blank', 'noopener,noreferrer');
      if (data.problem) toast.message(data.problem);
      refreshStatus();
    } catch (err) {
      win?.close();
      const detail = errorDetail(err) as { conflict?: boolean; remote_modified_by?: string; remote_modified_at?: string } | string | undefined;
      if (errorStatus(err) === 409 && typeof detail === 'object' && detail?.conflict) {
        setStatus(s => s && s.google ? {
          ...s,
          google: { ...s.google, state: 'conflict', remote_modified_by: detail.remote_modified_by, remote_modified_at: detail.remote_modified_at },
        } : s);
        toast.message('Changed here and in Google Docs — choose which version to keep first.');
      } else {
        toast.error(typeof detail === 'string' ? detail : 'Could not open it in Google Docs.');
      }
    } finally {
      setBusy(null);
    }
  };

  /** Settle a difference between the two copies without opening Google Docs. */
  const resolve = async (keep: 'app' | 'google') => {
    setBusy('resolve');
    try {
      if (keep === 'google') {
        await grants.pullWordDocFromGoogle(grantId, docId);
        setMountCount(n => n + 1); // the file changed under the editor — reopen it
        toast.success('Brought in the Google Docs version. The previous one is in version history.');
      } else {
        await grants.openWordDocInGoogle(grantId, docId, 'app');
        toast.success('The Google Doc now matches this version.');
      }
      refreshStatus();
    } catch (err) {
      const detail = errorDetail(err);
      toast.error(typeof detail === 'string' ? detail : 'Could not sync with Google Docs.');
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    try {
      await grants.unlinkWordDocGoogle(grantId, docId);
      refreshStatus();
    } catch {
      toast.error('Could not unlink the Google Docs copy.');
    }
  };

  const download = async () => {
    setBusy('download');
    try {
      const res = await grants.downloadWordDoc(grantId, docId);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = status?.file_name || fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download the document.');
    } finally {
      setBusy(null);
    }
  };

  const google = status?.google ?? null;
  const canEdit = status?.can_edit ?? false;
  const canCreateCopy = canEdit && (status?.google_connected ?? false);
  const googleButtonTitle = google
    ? `Google Docs copy${google.owner_name ? ` in ${google.owner_name}'s Drive` : ''}`
    : !canEdit ? 'An editor on this grant needs to open it in Google Docs first'
    : !status?.google_connected ? 'Connect your Google account in Settings → Integrations first'
    : 'Make a Google Docs copy in your Drive and open it';

  const toolbarButton = 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-[var(--radius-sm)] disabled:opacity-50';
  const banner = (() => {
    if (!google) {
      if (status && canEdit && !status.google_connected) {
        return (
          <span>
            To work on this in Google Docs, <Link href="/settings?tab=integrations" className="underline">connect your Google account</Link>.
          </span>
        );
      }
      return null;
    }
    const by = google.remote_modified_by ? ` by ${google.remote_modified_by}` : '';
    if (google.state === 'google_newer') {
      return canEdit ? (
        <>
          <span>Edited in Google Docs{by} {when(google.remote_modified_at)}.</span>
          <button onClick={() => void resolve('google')} disabled={!!busy} className="underline font-medium disabled:opacity-50">
            Bring in those edits
          </button>
        </>
      ) : <span>Edited in Google Docs{by} {when(google.remote_modified_at)}. An editor can bring those edits in.</span>;
    }
    if (google.state === 'conflict') {
      return (
        <>
          <span>Changed here and in Google Docs{by} since they were last in step.</span>
          {canEdit && (
            <>
              <button onClick={() => void resolve('google')} disabled={!!busy} className="underline font-medium disabled:opacity-50">
                Use the Google Docs version
              </button>
              <button onClick={() => void resolve('app')} disabled={!!busy} className="underline font-medium disabled:opacity-50">
                Keep this version
              </button>
              <span style={{ color: 'var(--ink-faint)' }}>The other one stays in version history.</span>
            </>
          )}
        </>
      );
    }
    if (google.state === 'unavailable' && google.problem) {
      return (
        <>
          <span>{google.problem}</span>
          {canEdit && <button onClick={() => void unlink()} className="underline font-medium">Unlink the copy</button>}
        </>
      );
    }
    return null;
  })();

  const toolbar = (
    <div
      className="flex items-center gap-3 px-3 h-11 shrink-0"
      style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-chrome)' }}
    >
      {readOnly && (
        <span className="text-[11px] px-1.5 py-0.5 rounded-[var(--radius-xs)]" style={{ color: 'var(--ink-muted)', background: 'var(--surface-sunken)' }}>
          View only
        </span>
      )}
      {variant === 'inline' && (
        <span className="text-xs truncate" style={{ color: 'var(--ink-faint)' }}>
          Word document · changes save for everyone automatically
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button
          onClick={() => void openInGoogle()}
          disabled={!!busy || !status || (!google && !canCreateCopy)}
          title={googleButtonTitle}
          className={toolbarButton}
          style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
        >
          {busy === 'google' ? <Loader2 size={13} className="animate-spin" /> : <GoogleDocsIcon />}
          Open in Google Docs
          <ExternalLink size={11} style={{ color: 'var(--ink-faint)' }} />
        </button>
        <button
          onClick={() => void download()}
          disabled={!!busy}
          className={toolbarButton}
          style={{ border: '1px solid var(--rule-strong)', color: 'var(--ink-secondary)' }}
        >
          {busy === 'download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Download
        </button>
      </div>
    </div>
  );

  const body = (
    <>
      {toolbar}
      {banner && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs shrink-0"
          style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)', borderBottom: '1px solid var(--rule-subtle)' }}
        >
          {busy === 'resolve' && <Loader2 size={12} className="animate-spin" />}
          {banner}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        {state !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-sm" style={{ color: 'var(--ink-muted)' }}>
            {state === 'loading' ? (
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Opening document…</span>
            ) : (
              <span style={{ color: 'var(--state-danger)' }}>{error}</span>
            )}
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </>
  );

  if (variant === 'panel') {
    return <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{body}</div>;
  }
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: 'calc(100vh - 210px)', minHeight: 520, border: '1px solid var(--rule-subtle)', borderTop: 'none' }}
    >
      {body}
    </div>
  );
}
