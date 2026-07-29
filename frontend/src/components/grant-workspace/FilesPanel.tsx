'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Paperclip, FolderOpen, Folder, Link as LinkIcon, LayoutTemplate, Users, Sparkles,
  File as FileIcon, FolderPlus, Upload, ChevronLeft, Plus, X, type LucideIcon,
} from 'lucide-react';
import { WorkspaceFile } from './types';
import { grants, documents } from '@/lib/api';
import { usePdfViewer } from '@/contexts/PdfViewerContext';
import { extractDocId } from '@/lib/extractDocId';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface WorkspaceFolder {
  id: string;
  grant_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

interface Props {
  grantId: string;
  /** Editors can add/remove files + folders; viewers get a read-only track. */
  canEdit?: boolean;
}

const CATEGORIES = [
  'call_documents', 'guidance_documents', 'proposal_drafts', 'final_proposal',
  'budget', 'budget_justification', 'letters_of_support', 'cvs_biosketches',
  'partner_documents', 'institutional_documents', 'templates', 'logos',
  'figures', 'references', 'submission_confirmation', 'award_rejection', 'other',
];

const SOURCE_TYPES = ['google_drive', 'external_url', 'template', 'partner_provided', 'ai_generated'];

const SOURCE_ICONS: Record<string, LucideIcon> = {
  uploaded: Paperclip,
  google_drive: FolderOpen,
  external_url: LinkIcon,
  template: LayoutTemplate,
  partner_provided: Users,
  ai_generated: Sparkles,
};

const SOURCE_LABELS: Record<string, string> = {
  google_drive: 'Google Drive',
  external_url: 'External URL',
  template: 'Template',
  partner_provided: 'Partner Provided',
  ai_generated: 'AI Generated',
};

function SourceIcon({ sourceType, className }: { sourceType: string; className?: string }) {
  const Icon = SOURCE_ICONS[sourceType] ?? FileIcon;
  return <Icon className={className ?? 'w-3.5 h-3.5 text-gray-400'} />;
}

// ── File card (used on both the front track and inside a folder) ────────────
function FileCard({
  file, canEdit, onDelete,
}: { file: WorkspaceFile; canEdit: boolean; onDelete: () => void }) {
  const docId = file.file_url ? extractDocId(file.file_url) : null;
  const { openPdfViewer } = usePdfViewer();

  const handleOpen = (e: React.MouseEvent) => {
    if (!docId) return;
    e.preventDefault();
    openPdfViewer(docId, file.file_name);
  };

  return (
    <div className="relative shrink-0 w-44 bg-white border border-gray-200 rounded-xl p-3 hover:border-indigo-200 hover:shadow-sm transition-all group">
      {canEdit && (
        <button
          onClick={onDelete}
          title="Remove file"
          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
          <SourceIcon sourceType={file.source_type} />
        </span>
      </div>
      <a
        href={file.file_url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        onClick={docId ? handleOpen : undefined}
        className="block text-sm font-medium text-gray-800 hover:text-indigo-600 leading-snug line-clamp-2"
        title={file.file_name}
      >
        {file.file_name}
      </a>
      <div className="flex gap-1 mt-2 flex-wrap">
        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
          {file.file_category.replace(/_/g, ' ')}
        </span>
        {file.tags?.map((tag) => (
          <span key={tag} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Folder card (front track only) ──────────────────────────────────────────
function FolderCard({
  folder, count, canEdit, onOpen, onDelete,
}: { folder: WorkspaceFolder; count: number; canEdit: boolean; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="relative shrink-0 w-44 group">
      <button
        onClick={onOpen}
        className="w-full text-left bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-xl p-3 hover:border-indigo-300 hover:shadow-sm transition-all"
      >
        <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center mb-2">
          <Folder className="w-4 h-4 text-indigo-500" />
        </span>
        <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2" title={folder.name}>
          {folder.name}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">{count} file{count !== 1 ? 's' : ''}</p>
      </button>
      {canEdit && (
        <button
          onClick={onDelete}
          title="Delete folder (files move back out)"
          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Add-file form (lifted from FileLibrary; supports a target folder) ────────
function AddFileForm({
  grantId, folderId, onDone, onCancel,
}: { grantId: string; folderId: string | null; onDone: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'upload' | 'link'>('link');
  const [saving, setSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    file_name: '', file_url: '', file_category: 'other',
    source_type: 'external_url', version: '1', description: '', tags: '',
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !form.file_name) {
      setForm((f) => ({ ...f, file_name: file.name.replace(/\.[^.]+$/, '') }));
    }
  };

  const parseTags = (raw: string) => (raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (mode === 'upload') {
        if (!selectedFile) return;
        const uploadRes = await documents.upload(selectedFile, grantId);
        const docId: string = uploadRes.data.id;
        await grants.addFile(grantId, {
          ...form,
          file_url: `${API_URL}/api/v1/documents/${docId}/content`,
          source_type: 'uploaded',
          file_type: selectedFile.name.split('.').pop() ?? '',
          tags: parseTags(form.tags),
          folder_id: folderId,
        });
      } else {
        await grants.addFile(grantId, {
          ...form,
          tags: parseTags(form.tags),
          folder_id: folderId,
        });
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleCreate} className="bg-indigo-50/60 rounded-xl border border-indigo-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit text-xs">
          <button
            type="button"
            onClick={() => { setMode('upload'); setForm((f) => ({ ...f, source_type: 'uploaded' })); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${mode === 'upload' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <Upload className="w-3.5 h-3.5" /> Upload
          </button>
          <button
            type="button"
            onClick={() => { setMode('link'); setForm((f) => ({ ...f, source_type: 'external_url' })); setSelectedFile(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${mode === 'link' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <LinkIcon className="w-3.5 h-3.5" /> Link
          </button>
        </div>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          required
          placeholder="Name"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={form.file_name}
          onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))}
        />
        {mode === 'link' && (
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.source_type}
            onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{SOURCE_LABELS[t] ?? t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        )}
      </div>

      {mode === 'upload' ? (
        <div
          className="w-full border-2 border-dashed border-indigo-200 rounded-lg px-3 py-4 text-sm text-center cursor-pointer hover:border-indigo-400 transition-colors bg-white"
          onClick={() => fileInputRef.current?.click()}
        >
          {selectedFile
            ? <span className="text-indigo-700 font-medium">{selectedFile.name}</span>
            : <span className="text-gray-400">Click to select a PDF, Word doc, or text file</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={handleFileSelect}
            required={mode === 'upload'}
          />
        </div>
      ) : (
        <input
          required
          type="url"
          placeholder="URL / link"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={form.file_url}
          onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={form.file_category}
          onChange={(e) => setForm((f) => ({ ...f, file_category: e.target.value }))}
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <input
          placeholder="Version (e.g. v2)"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={form.version}
          onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
        />
      </div>
      <input
        placeholder="Tags (comma separated)"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        value={form.tags}
        onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
      />
      <input
        placeholder="Description (optional)"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 px-2">Cancel</button>
        <button
          type="submit"
          disabled={saving || (mode === 'upload' && !selectedFile)}
          className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Add file'}
        </button>
      </div>
    </form>
  );
}

export default function FilesPanel({ grantId, canEdit = true }: Props) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [addingFileTo, setAddingFileTo] = useState<string | null | undefined>(undefined); // undefined=closed, null=loose, id=folder
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const refresh = useCallback(() => {
    grants.listFiles(grantId).then((r) => setFiles(r.data)).catch(console.error);
    grants.listFolders(grantId).then((r) => setFolders(r.data)).catch(console.error);
  }, [grantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const looseFiles = files.filter((f) => !f.folder_id);
  const folderFiles = (fid: string) => files.filter((f) => f.folder_id === fid);
  const openFolder = folders.find((f) => f.id === openFolderId) ?? null;

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Remove this file?')) return;
    await grants.deleteFile(grantId, fileId);
    refresh();
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Delete this folder? Its files move back to the front, they are not deleted.')) return;
    await grants.deleteFolder(grantId, folderId);
    if (openFolderId === folderId) setOpenFolderId(null);
    refresh();
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await grants.addFolder(grantId, { name: newFolderName.trim() });
    setNewFolderName('');
    setAddingFolder(false);
    refresh();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          {openFolder ? (
            <>
              <button
                onClick={() => setOpenFolderId(null)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Files
              </button>
              <span className="text-gray-300">/</span>
              <span className="text-sm font-semibold text-gray-800 truncate">{openFolder.name}</span>
            </>
          ) : (
            <h3 className="text-sm font-semibold text-gray-800">Saved Files</h3>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            {!openFolder && (
              <button
                onClick={() => { setAddingFolder((v) => !v); setAddingFileTo(undefined); }}
                className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <FolderPlus className="w-3.5 h-3.5" /> Add folder
              </button>
            )}
            <button
              onClick={() => { setAddingFileTo(openFolder ? openFolder.id : null); setAddingFolder(false); }}
              className="text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add file
            </button>
          </div>
        )}
      </div>

      {/* Inline forms */}
      {(addingFolder || addingFileTo !== undefined) && (
        <div className="px-4 pt-4">
          {addingFolder && (
            <form onSubmit={handleCreateFolder} className="flex items-center gap-2 mb-2">
              <input
                autoFocus
                placeholder="Folder name"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
              <button type="submit" className="text-xs px-3 py-2 bg-indigo-600 text-white rounded-lg">Create</button>
              <button type="button" onClick={() => { setAddingFolder(false); setNewFolderName(''); }} className="text-xs text-gray-500 px-1">Cancel</button>
            </form>
          )}
          {addingFileTo !== undefined && (
            <AddFileForm
              grantId={grantId}
              folderId={addingFileTo}
              onDone={() => { setAddingFileTo(undefined); refresh(); }}
              onCancel={() => setAddingFileTo(undefined)}
            />
          )}
        </div>
      )}

      {/* Sliding track: front (folders + loose files) ↔ open folder */}
      <div className="overflow-hidden">
        <div
          className="flex w-[200%] transition-transform duration-300 ease-out"
          style={{ transform: openFolder ? 'translateX(-50%)' : 'translateX(0)' }}
        >
          {/* Slide 1 — front */}
          <div className="w-1/2 p-4">
            {folders.length === 0 && looseFiles.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                No files yet. Add a file or create a folder to organize them.
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {folders.map((fo) => (
                  <FolderCard
                    key={fo.id}
                    folder={fo}
                    count={folderFiles(fo.id).length}
                    canEdit={canEdit}
                    onOpen={() => setOpenFolderId(fo.id)}
                    onDelete={() => handleDeleteFolder(fo.id)}
                  />
                ))}
                {looseFiles.map((f) => (
                  <FileCard key={f.id} file={f} canEdit={canEdit} onDelete={() => handleDeleteFile(f.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Slide 2 — inside the open folder */}
          <div className="w-1/2 p-4">
            {openFolder && (
              folderFiles(openFolder.id).length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  This folder is empty. Use “Add file” to put a tagged file here.
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {folderFiles(openFolder.id).map((f) => (
                    <FileCard key={f.id} file={f} canEdit={canEdit} onDelete={() => handleDeleteFile(f.id)} />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
