'use client';

import { useState } from 'react';
import {
  FileText, Link2, ExternalLink, CloudUpload, CloudDownload, Check, Loader2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { grants } from '@/lib/api';

export type SyncState = 'idle' | 'pushing' | 'pulling' | 'creating' | 'success' | 'error';

interface GoogleDocsControlProps {
  grantId: string;
  docLinked: boolean;
  docUrl: string;
  syncState: SyncState;
  onDocLinked: (docId: string, url: string) => void;
  onUnlink: () => void;
  onPushToDoc: () => void;
  onPullFromDoc: () => void;
}

const muted = { color: 'var(--ink-muted)' };

function errorDetail(err: unknown): string | undefined {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
}

/** Compact Google Doc link / sync controls for the editor's top bar. */
export default function GoogleDocsControl({
  grantId, docLinked, docUrl, syncState, onDocLinked, onUnlink, onPushToDoc, onPullFromDoc,
}: GoogleDocsControlProps) {
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const syncBusy = syncState === 'pushing' || syncState === 'pulling';

  const handleCreate = async () => {
    setLinking(true);
    try {
      const res = await grants.createGoogleDoc(grantId);
      onDocLinked(res.data.doc_id, res.data.doc_url);
    } catch (err: unknown) {
      toast.error(errorDetail(err) || 'Failed to create Google Doc.');
    } finally {
      setLinking(false);
    }
  };

  const handleLink = async () => {
    if (!linkInput?.trim()) return;
    setLinking(true);
    try {
      const res = await grants.linkGoogleDoc(grantId, linkInput.trim());
      onDocLinked(res.data.doc_id, res.data.doc_url);
      setLinkInput(null);
      onPullFromDoc(); // bring the linked doc's content into the editor
    } catch (err: unknown) {
      toast.error(errorDetail(err) || 'Failed to link Google Doc.');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    try {
      await grants.unlinkGoogleDoc(grantId);
      onUnlink();
    } catch (err: unknown) {
      toast.error(errorDetail(err) || 'Failed to unlink Google Doc.');
    }
  };

  if (docLinked) {
    return (
      <div className="flex items-center gap-2 text-xs" style={muted}>
        <a href={docUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 hover:underline" style={{ color: 'var(--ink-secondary)' }}>
          <FileText className="w-3.5 h-3.5" /> Google Doc <ExternalLink className="w-2.5 h-2.5" />
        </a>
        {syncBusy && <Loader2 className="w-3 h-3 animate-spin" />}
        {syncState === 'success' && <Check className="w-3 h-3" style={{ color: 'var(--state-success)' }} />}
        <button onClick={onPushToDoc} disabled={syncBusy} title="Push to Google Doc" className="disabled:opacity-40">
          <CloudUpload className="w-3.5 h-3.5" />
        </button>
        <button onClick={onPullFromDoc} disabled={syncBusy} title="Pull from Google Doc" className="disabled:opacity-40">
          <CloudDownload className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => void handleUnlink()} title="Unlink Google Doc">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (linkInput !== null) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <input
          autoFocus
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleLink();
            if (e.key === 'Escape') setLinkInput(null);
          }}
          placeholder="Paste Google Doc URL…"
          className="w-52 px-1.5 py-0.5 rounded-[var(--radius-xs)] outline-none"
          style={{ border: '1px solid var(--rule-strong)', background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
        />
        <button onClick={() => void handleLink()} disabled={linking || !linkInput.trim()} className="disabled:opacity-40" style={muted}>
          {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </button>
        <button onClick={() => setLinkInput(null)} style={muted}><X className="w-3 h-3" /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs" style={muted}>
      <button onClick={() => void handleCreate()} disabled={linking} className="flex items-center gap-1 disabled:opacity-40">
        {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
        Create Google Doc
      </button>
      <span style={{ color: 'var(--ink-faint)' }}>|</span>
      <button onClick={() => setLinkInput('')} className="flex items-center gap-1">
        <Link2 className="w-3 h-3" /> Link existing
      </button>
    </div>
  );
}
