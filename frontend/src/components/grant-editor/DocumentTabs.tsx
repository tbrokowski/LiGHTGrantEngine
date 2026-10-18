'use client';

import { useEffect, useRef, useState } from 'react';
import { FilePlus, FileText, FileUp, Loader2, Plus, X } from 'lucide-react';

export interface WritingDoc {
  id: string;
  title: string;
  content_html: string;
}

/** The main proposal's tab id — also its comments `document_id`. */
export const PROPOSAL_DOC_ID = 'draft';

interface DocumentTabsProps {
  docs: WritingDoc[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: (file: File) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  busy?: boolean;
}

/** Tabs above the editor: the proposal, then any other writing documents. */
export default function DocumentTabs({
  docs, activeId, onSelect, onCreate, onImport, onRename, onDelete, busy,
}: DocumentTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const commitRename = () => {
    const title = draftTitle.trim();
    if (editingId && title) onRename(editingId, title);
    setEditingId(null);
  };

  const tab = (id: string, title: string, removable: boolean) => {
    const active = id === activeId;
    return (
      <div
        key={id}
        className="group flex items-center gap-1.5 max-w-[220px] px-3 py-1.5 text-xs rounded-t-[var(--radius-sm)] cursor-pointer select-none"
        style={{
          background: active ? 'var(--surface-raised)' : 'transparent',
          color: active ? 'var(--ink-primary)' : 'var(--ink-muted)',
          border: '1px solid',
          borderColor: active ? 'var(--rule-subtle)' : 'transparent',
          borderBottomColor: active ? 'var(--surface-raised)' : 'transparent',
          marginBottom: -1,
        }}
        onClick={() => onSelect(id)}
        onDoubleClick={() => { if (removable) { setEditingId(id); setDraftTitle(title); } }}
        title={removable ? `${title} — double-click to rename` : title}
      >
        <FileText className="w-3.5 h-3.5 shrink-0" />
        {editingId === id ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-32 bg-transparent outline-none border-b"
            style={{ borderColor: 'var(--rule-strong, var(--rule-subtle))', color: 'var(--ink-primary)' }}
          />
        ) : (
          <span className="truncate font-medium">{title}</span>
        )}
        {removable && editingId !== id && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${title}"? Its text and comments will be removed.`)) onDelete(id);
            }}
            title="Delete document"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex items-end gap-0.5 overflow-x-auto" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
      {tab(PROPOSAL_DOC_ID, 'Proposal', false)}
      {docs.map((d) => tab(d.id, d.title, true))}
      <div ref={menuRef} className="relative ml-1 mb-1">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          title="Add a document"
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--selection-bg)] disabled:opacity-50"
          style={{ color: 'var(--ink-muted)' }}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New document
        </button>
        {menuOpen && (
          <div
            className="absolute top-full left-0 mt-1 z-50 w-52 py-1 rounded-[var(--radius-md)]"
            style={{ background: 'var(--surface-panel)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
          >
            <button
              onClick={() => { setMenuOpen(false); onCreate(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--selection-bg)]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <FilePlus className="w-3.5 h-3.5" /> Blank document
            </button>
            <button
              onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--selection-bg)]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <FileUp className="w-3.5 h-3.5" /> Import file (.docx, .md, .txt)
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.html,.htm,.md,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onImport(f);
          }}
        />
      </div>
    </div>
  );
}
