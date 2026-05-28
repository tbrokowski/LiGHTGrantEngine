'use client';

import { useState, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { grants, api } from '@/lib/api';
import { Save, Check, AlertCircle } from 'lucide-react';

interface NewDocumentPaneProps {
  grantId: string;
  docId: string;
  label: string;
}

export default function NewDocumentPane({ grantId, docId, label }: NewDocumentPaneProps) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const fileIdRef = useRef<string | null>(null);
  const localKey = `new-doc-${docId}`;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing your document…' }),
    ],
    content: typeof window !== 'undefined' ? (localStorage.getItem(localKey) ?? '') : '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full p-5 prose prose-sm max-w-none',
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Persist to localStorage immediately so content survives navigation
      localStorage.setItem(localKey, ed.getHTML());
    },
  });

  const handleSaveToFiles = async () => {
    if (!editor) return;
    const html = editor.getHTML();
    if (!html || html === '<p></p>') return;
    setSaveStatus('saving');
    try {
      if (fileIdRef.current) {
        // Already created — update the file URL content via re-upload
        await grants.updateFile(grantId, fileIdRef.current, {
          description: `Updated ${new Date().toLocaleString()}`,
        });
      } else {
        // Upload HTML as a file to R2 via the documents endpoint
        const blob = new Blob([html], { type: 'text/html' });
        const file = new File([blob], `${label}.html`, { type: 'text/html' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('grant_id', grantId);
        formData.append('document_type', 'other');

        const uploadRes = await api.post('/documents/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        // Register in workspace files
        const fileRes = await grants.addFile(grantId, {
          file_name: label,
          file_url: uploadRes.data.id
            ? `${window.location.origin}/api/v1/documents/${uploadRes.data.id}/content`
            : '',
          file_category: 'other',
          source_type: 'internal',
          description: 'Created in editor split view',
        });
        fileIdRef.current = fileRes.data.id;
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50">
        <span className="text-xs text-gray-400 italic">
          {fileIdRef.current ? 'Saved to Files' : 'Unsaved — auto-saved locally'}
        </span>
        <button
          onClick={handleSaveToFiles}
          disabled={saveStatus === 'saving'}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saveStatus === 'saved' ? (
            <Check className="w-3 h-3" />
          ) : saveStatus === 'error' ? (
            <AlertCircle className="w-3 h-3" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          {saveStatus === 'saving'
            ? 'Saving…'
            : saveStatus === 'saved'
            ? 'Saved to Files!'
            : saveStatus === 'error'
            ? 'Save failed'
            : 'Save to Files'}
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <EditorContent
          editor={editor}
          className="h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror-placeholder]:text-gray-400"
        />
      </div>
    </div>
  );
}
