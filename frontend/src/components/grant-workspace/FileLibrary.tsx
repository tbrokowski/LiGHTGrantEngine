'use client';

import { useState } from 'react';
import { WorkspaceFile } from './types';
import { grants } from '@/lib/api';

interface Props {
  grantId: string;
  files: WorkspaceFile[];
  onRefresh: () => void;
}

const CATEGORIES = [
  'call_documents', 'guidance_documents', 'proposal_drafts', 'final_proposal',
  'budget', 'budget_justification', 'letters_of_support', 'cvs_biosketches',
  'partner_documents', 'institutional_documents', 'templates', 'logos',
  'figures', 'references', 'submission_confirmation', 'award_rejection', 'other',
];

const SOURCE_TYPES = ['uploaded', 'google_drive', 'external_url', 'template', 'partner_provided', 'ai_generated'];

const SOURCE_ICONS: Record<string, string> = {
  uploaded: '📎',
  google_drive: '📁',
  external_url: '🔗',
  template: '📋',
  partner_provided: '🤝',
  ai_generated: '🤖',
};

function FileCard({ file, onDelete }: { file: WorkspaceFile; onDelete: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 hover:border-indigo-200 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{SOURCE_ICONS[file.source_type] ?? '📄'}</span>
            <a
              href={file.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-indigo-600 hover:underline truncate"
            >
              {file.file_name}
            </a>
          </div>
          {file.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{file.description}</p>
          )}
          <div className="flex gap-2 mt-1.5 flex-wrap">
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {file.file_category.replace(/_/g, ' ')}
            </span>
            {file.version !== '1' && (
              <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">v{file.version}</span>
            )}
            {file.tags?.map((tag) => (
              <span key={tag} className="text-xs bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded border border-gray-100">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-1">{file.uploaded_at?.split('T')[0]}</p>
        </div>
        <button
          onClick={onDelete}
          className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default function FileLibrary({ grantId, files, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    file_name: '',
    file_url: '',
    file_category: 'other',
    source_type: 'external_url',
    version: '1',
    description: '',
    tags: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await grants.addFile(grantId, {
        ...form,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      });
      setForm({ file_name: '', file_url: '', file_category: 'other', source_type: 'external_url', version: '1', description: '', tags: '' });
      setShowForm(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm('Remove this file?')) return;
    await grants.deleteFile(grantId, fileId);
    onRefresh();
  };

  const handleCreateDriveFolder = async () => {
    setCreatingFolder(true);
    try {
      const res = await grants.createDriveFolder(grantId);
      setDriveFolderUrl(res.data.root_folder_url);
    } catch {
      alert('Could not create Drive folder. Make sure google_drive is configured in config.yaml.');
    } finally {
      setCreatingFolder(false);
    }
  };

  const grouped = CATEGORIES.reduce<Record<string, WorkspaceFile[]>>((acc, cat) => {
    const catFiles = files.filter((f) => f.file_category === cat);
    if (catFiles.length > 0) acc[cat] = catFiles;
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-800">Files & Assets</h2>
        <div className="flex items-center gap-2">
          {driveFolderUrl ? (
            <a
              href={driveFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-indigo-600 hover:bg-gray-50 flex items-center gap-1"
            >
              📁 Open Drive Folder
            </a>
          ) : (
            <button
              onClick={handleCreateDriveFolder}
              disabled={creatingFolder}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {creatingFolder ? 'Creating…' : '📁 Create Drive Folder'}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            + Add File / Link
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="File / link name"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.file_name}
              onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))}
            />
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.source_type}
              onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{SOURCE_ICONS[t]} {t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <input
            required
            type="url"
            placeholder="URL / link"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.file_url}
            onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.file_category}
              onChange={(e) => setForm((f) => ({ ...f, file_category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <input
              placeholder="Version (e.g. v2)"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={form.version}
              onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
            />
          </div>
          <input
            placeholder="Description (optional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <input
            placeholder="Tags (comma separated)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-gray-500">Cancel</button>
            <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {/* Category filter */}
      {Object.keys(grouped).length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={`text-xs px-2.5 py-1 rounded-full border ${!activeCategory ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}
          >
            All ({files.length})
          </button>
          {Object.keys(grouped).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`text-xs px-2.5 py-1 rounded-full border ${activeCategory === cat ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}
            >
              {cat.replace(/_/g, ' ')} ({grouped[cat].length})
            </button>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No files linked yet. Add Google Drive links, external URLs, or upload references.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped)
            .filter(([cat]) => !activeCategory || cat === activeCategory)
            .map(([cat, catFiles]) => (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {cat.replace(/_/g, ' ')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {catFiles.map((f) => (
                    <FileCard key={f.id} file={f} onDelete={() => handleDelete(f.id)} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
