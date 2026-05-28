'use client';

import { useState, useRef, useCallback } from 'react';
import { grants, api } from '@/lib/api';
import { Save, Check, AlertCircle } from 'lucide-react';
import SingleDocEditor from '../SingleDocEditor';

interface NewDocumentPaneProps {
  grantId: string;
  docId: string;
  label: string;
}

export default function NewDocumentPane({ grantId, docId, label }: NewDocumentPaneProps) {
  const localKey = `new-doc-${docId}`;
  const [documentHtml, setDocumentHtml] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(localKey) ?? '';
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const fileIdRef = useRef<string | null>(null);

  const handleDocumentChange = useCallback((html: string, _words: number, _headings: string[]) => {
    setDocumentHtml(html);
    localStorage.setItem(localKey, html);
  }, [localKey]);

  const handleSaveToFiles = async () => {
    if (!documentHtml || documentHtml === '<p></p>') return;
    setSaveStatus('saving');
    try {
      if (fileIdRef.current) {
        await grants.updateFile(grantId, fileIdRef.current, {
          description: `Updated ${new Date().toLocaleString()}`,
        });
      } else {
        const blob = new Blob([documentHtml], { type: 'text/html' });
        const file = new File([blob], `${label}.html`, { type: 'text/html' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('grant_id', grantId);
        formData.append('document_type', 'other');

        const uploadRes = await api.post('/documents/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

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
      {/* Sub-toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50">
        <span className="text-xs text-gray-400 italic">
          {fileIdRef.current ? 'Saved to Files ✓' : 'Auto-saved locally'}
        </span>
        <button
          onClick={handleSaveToFiles}
          disabled={saveStatus === 'saving' || !documentHtml || documentHtml === '<p></p>'}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saveStatus === 'saved' ? (
            <Check className="w-3 h-3" />
          ) : saveStatus === 'error' ? (
            <AlertCircle className="w-3 h-3" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          {saveStatus === 'saving' ? 'Saving…'
            : saveStatus === 'saved' ? 'Saved to Files!'
            : saveStatus === 'error' ? 'Save failed'
            : 'Save to Files'}
        </button>
      </div>

      {/* Full-featured editor — same as Draft Editor */}
      <div className="flex flex-1 overflow-hidden">
        <SingleDocEditor
          documentHtml={documentHtml}
          onDocumentChange={handleDocumentChange}
          onSelectionChange={() => {}}
          onActiveSectionChange={() => {}}
        />
      </div>
    </div>
  );
}
