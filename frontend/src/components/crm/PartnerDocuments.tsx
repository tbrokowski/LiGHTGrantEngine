'use client';
import { useState, useRef } from 'react';
import { Upload, FileText, Trash2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface ExpertiseItem {
  area: string;
  confidence: number;
  keywords?: string[];
}

interface PartnerDoc {
  id: string;
  document_type: string;
  filename?: string;
  file_size?: number;
  expertise_extracted: ExpertiseItem[];
  created_at?: string;
}

interface PartnerDocumentsProps {
  partnerId: string;
  documents: PartnerDoc[];
  onRefresh: () => void;
}

const DOCTYPE_LABELS: Record<string, string> = {
  cv: '📄 CV / Resume',
  bio: '👤 Bio',
  paper: '📰 Paper',
  letter_of_support: '📝 Letter of Support',
  other: '📎 Other',
};

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function PartnerDocuments({ partnerId, documents, onRefresh }: PartnerDocumentsProps) {
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState('cv');
  const [extracting, setExtracting] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', docType);
      await partnersApi.uploadDocument(partnerId, formData);
      onRefresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleExtract(docId: string) {
    setExtracting(docId);
    try {
      await partnersApi.extractExpertise(partnerId, docId);
      onRefresh();
    } finally { setExtracting(null); }
  }

  async function handleDelete(docId: string) {
    if (!confirm('Delete this document?')) return;
    await partnersApi.deleteDocument(partnerId, docId);
    onRefresh();
  }

  return (
    <div>
      {/* Upload area */}
      <div className="border border-dashed border-gray-300 rounded-xl p-5 mb-5 text-center">
        <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500 mb-3">Upload CV, bio, papers, or letters of support</p>
        <div className="flex items-center justify-center gap-2">
          <select value={docType} onChange={e => setDocType(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {Object.entries(DOCTYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {uploading ? 'Uploading…' : 'Choose File'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileUpload} />
        <p className="text-xs text-gray-400 mt-2">PDF, Word, or text files · AI extracts expertise automatically</p>
      </div>

      {/* Document list */}
      {documents.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-6">No documents uploaded yet.</div>
      ) : (
        <div className="space-y-3">
          {documents.map(doc => (
            <div key={doc.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="p-3.5 flex items-start gap-3">
                <FileText className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">{DOCTYPE_LABELS[doc.document_type] || doc.document_type}</span>
                    {doc.expertise_extracted.length > 0 && (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                        {doc.expertise_extracted.length} expertise areas
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-800 truncate mt-0.5">
                    {doc.filename || 'Untitled document'}
                  </p>
                  {doc.file_size && <p className="text-xs text-gray-400">{formatSize(doc.file_size)}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {doc.expertise_extracted.length === 0 && (
                    <button onClick={() => handleExtract(doc.id)} disabled={extracting === doc.id}
                      className="flex items-center gap-1 text-xs text-purple-600 border border-purple-200 px-2 py-1 rounded-lg hover:bg-purple-50 disabled:opacity-50">
                      <Sparkles className="w-3 h-3" />
                      {extracting === doc.id ? 'Extracting…' : 'Extract'}
                    </button>
                  )}
                  {doc.expertise_extracted.length > 0 && (
                    <button onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                      className="p-1 text-gray-400 hover:text-gray-600">
                      {expandedDoc === doc.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  )}
                  <button onClick={() => handleDelete(doc.id)}
                    className="p-1 text-gray-300 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Expertise breakdown */}
              {expandedDoc === doc.id && doc.expertise_extracted.length > 0 && (
                <div className="border-t border-gray-100 px-3.5 py-3 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Extracted Expertise</p>
                  <div className="space-y-2">
                    {doc.expertise_extracted.map((exp, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm text-gray-700 font-medium">{exp.area}</span>
                        </div>
                        <ConfidenceBar value={exp.confidence} />
                        {exp.keywords && exp.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {exp.keywords.map(kw => (
                              <span key={kw} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{kw}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
