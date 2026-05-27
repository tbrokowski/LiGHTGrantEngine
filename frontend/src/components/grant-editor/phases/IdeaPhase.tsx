'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Upload, Mic, MicOff, Loader2, Sparkles, FileText, RefreshCw,
  ExternalLink, Link2, PlusCircle, CloudUpload, CloudDownload, CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { grantWriting, grants as grantsApi } from '@/lib/api';
import CallRequirementsPanel from '../CallRequirementsPanel';

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

type SpeechRecognitionCtor = new () => ISpeechRecognition;

interface UploadedCallDoc {
  document_id: string;
  file_name: string;
  file_url: string;
  uploaded_at?: string;
}

interface IdeaPhaseProps {
  grantId: string;
  grantIdea: string;
  callAnalysis: Record<string, unknown>;
  stylePreview?: Array<Record<string, unknown>>;
  onIdeaChange: (idea: string) => void;
  onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => void;
  onGenerateSkeleton: () => void;
  generating: boolean;
  googleDocId?: string | null;
  googleDocUrl?: string | null;
  googleDocLastSynced?: string | null;
  onDocLinked?: (docId: string, docUrl: string) => void;
  onDocPulled?: (html: string) => void;
}

export default function IdeaPhase({
  grantId,
  grantIdea,
  callAnalysis,
  onIdeaChange,
  onCallAnalysis,
  onGenerateSkeleton,
  generating,
  googleDocId,
  googleDocUrl,
  googleDocLastSynced,
  onDocLinked,
  onDocPulled,
}: IdeaPhaseProps) {
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedCallDoc | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);

  // Google Docs state
  const [docLinkInput, setDocLinkInput] = useState('');
  const [showDocLinkInput, setShowDocLinkInput] = useState(false);
  const [docSyncState, setDocSyncState] = useState<'idle' | 'linking' | 'creating' | 'pushing' | 'pulling' | 'success' | 'error'>('idle');
  const [docSyncError, setDocSyncError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  // If call analysis is already loaded (page reload), show a placeholder doc row
  const hasExistingAnalysis = callAnalysis && Object.keys(callAnalysis).length > 0;

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { data } = await grantWriting.uploadCall(grantId, file);
      setUploadedDoc({
        document_id: data.document_id,
        file_name: data.file_name || file.name,
        file_url: data.file_url || '',
        uploaded_at: new Date().toISOString(),
      });
      onCallAnalysis(data.call_analysis || {}, data.call_requirements);
    } finally {
      setUploading(false);
    }
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    try {
      const res = await grantWriting.analyzeCall(grantId);
      onCallAnalysis(res.data.call_analysis || {}, res.data.call_requirements);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.pdf') || file.name.endsWith('.docx') || file.name.endsWith('.txt'))) {
      handleUpload(file);
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);

  const toggleVoice = () => {
    const win = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { setListening(false); return; }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const { transcript } = event.results[0][0];
      onIdeaChange(grantIdea ? `${grantIdea}\n${transcript}` : transcript);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  // Google Docs handlers
  const handleLinkGoogleDoc = async () => {
    if (!docLinkInput.trim()) return;
    setDocSyncState('linking');
    setDocSyncError('');
    try {
      const { data } = await grantsApi.linkGoogleDoc(grantId, docLinkInput.trim());
      onDocLinked?.(data.google_doc_id, data.google_doc_url);
      setShowDocLinkInput(false);
      setDocLinkInput('');
      setDocSyncState('success');
      setTimeout(() => setDocSyncState('idle'), 2000);
    } catch {
      setDocSyncError('Failed to link Google Doc. Check the URL and try again.');
      setDocSyncState('error');
    }
  };

  const handleCreateGoogleDoc = async () => {
    setDocSyncState('creating');
    setDocSyncError('');
    try {
      const res = await grantsApi.createGoogleDoc(grantId);
      onDocLinked?.(res.data.google_doc_id, res.data.google_doc_url);
      setDocSyncState('success');
      setTimeout(() => setDocSyncState('idle'), 2000);
    } catch {
      setDocSyncError('Failed to create Google Doc.');
      setDocSyncState('error');
    }
  };

  const handlePullFromDoc = async () => {
    setDocSyncState('pulling');
    setDocSyncError('');
    try {
      const res = await grantsApi.pullFromGoogleDoc(grantId);
      onDocPulled?.(res.data.content_html || '');
      setDocSyncState('success');
      setTimeout(() => setDocSyncState('idle'), 2000);
    } catch {
      setDocSyncError('Failed to pull from Google Doc.');
      setDocSyncState('error');
    }
  };

  const handlePushToDoc = async () => {
    setDocSyncState('pushing');
    setDocSyncError('');
    try {
      await grantsApi.pushToGoogleDoc(grantId);
      setDocSyncState('success');
      setTimeout(() => setDocSyncState('idle'), 2000);
    } catch {
      setDocSyncError('Failed to push to Google Doc.');
      setDocSyncState('error');
    }
  };

  const docSyncBusy = ['linking', 'creating', 'pushing', 'pulling'].includes(docSyncState);
  const docLinked = !!googleDocId;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full p-6 space-y-6">
      {/* Grant Idea */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Your Grant Idea</h2>
        <p className="text-xs text-gray-500 mb-3">
          Describe your overall concept — the problem, approach, and impact you want to pursue.
        </p>
        <div className="relative">
          <textarea
            value={grantIdea}
            onChange={(e) => onIdeaChange(e.target.value)}
            rows={8}
            placeholder="We propose to develop an AI-powered diagnostic tool for..."
            className="w-full text-sm border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          />
          <button
            type="button"
            onClick={toggleVoice}
            className={`absolute bottom-3 right-3 p-2 rounded-full ${
              listening ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            title="Voice input"
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Call Document Upload */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Call Document</h2>
        <p className="text-xs text-gray-500 mb-3">
          Upload the grant call PDF or DOCX — a detailed brief will be extracted automatically
          and the file will be saved to your project files.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !uploading && fileRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg px-4 py-6 cursor-pointer transition-colors ${
            isDragOver
              ? 'border-indigo-400 bg-indigo-50'
              : uploading
              ? 'border-gray-200 bg-gray-50 cursor-default'
              : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              <span className="text-sm text-gray-600">Analyzing call document…</span>
              <span className="text-xs text-gray-400">This may take a minute for long documents</span>
            </>
          ) : (
            <>
              <Upload className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-600">
                {isDragOver ? 'Drop to upload' : 'Drag & drop or click to upload'}
              </span>
              <span className="text-xs text-gray-400">PDF, DOCX, or TXT</span>
            </>
          )}
        </div>

        {/* Uploaded doc row */}
        {(uploadedDoc || hasExistingAnalysis) && !uploading && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <FileText className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
            <span className="flex-1 truncate font-medium text-green-800">
              {uploadedDoc?.file_name ?? 'Call document analyzed'}
            </span>
            {uploadedDoc?.file_url && (
              <a
                href={uploadedDoc.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:text-indigo-600"
                title="View file"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="flex items-center gap-1 text-gray-500 hover:text-indigo-600 disabled:opacity-50"
              title="Re-analyze"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
              <span>Re-analyze</span>
            </button>
          </div>
        )}
      </div>

      {/* Google Docs Integration */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Google Docs</h2>
        <p className="text-xs text-gray-500 mb-3">
          Link a Google Doc to collaborate on the proposal there. The AI assistant will be able to read and write to the linked document.
        </p>

        {docLinked ? (
          <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
              <a
                href={googleDocUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-green-800 hover:underline truncate flex-1"
              >
                Google Doc linked
              </a>
              <ExternalLink className="w-3.5 h-3.5 text-green-600" />
            </div>
            {googleDocLastSynced && (
              <p className="text-xs text-green-700 pl-6">
                Last synced: {new Date(googleDocLastSynced).toLocaleString()}
              </p>
            )}
            <p className="text-xs text-green-700 pl-6 italic">
              AI assistant can read this document
            </p>
            <div className="flex gap-2 pt-1 pl-6">
              <button
                onClick={handlePullFromDoc}
                disabled={docSyncBusy}
                className="flex items-center gap-1.5 text-xs bg-white border border-green-300 text-green-800 px-3 py-1.5 rounded hover:bg-green-100 disabled:opacity-50"
              >
                {docSyncState === 'pulling' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CloudDownload className="w-3 h-3" />
                )}
                Pull from Doc
              </button>
              <button
                onClick={handlePushToDoc}
                disabled={docSyncBusy}
                className="flex items-center gap-1.5 text-xs bg-white border border-green-300 text-green-800 px-3 py-1.5 rounded hover:bg-green-100 disabled:opacity-50"
              >
                {docSyncState === 'pushing' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CloudUpload className="w-3 h-3" />
                )}
                Push to Doc
              </button>
            </div>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            {!showDocLinkInput ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDocLinkInput(true)}
                  disabled={docSyncBusy}
                  className="flex items-center gap-1.5 text-xs border border-gray-300 text-gray-700 px-3 py-2 rounded hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Link existing Google Doc
                </button>
                <button
                  onClick={handleCreateGoogleDoc}
                  disabled={docSyncBusy}
                  className="flex items-center gap-1.5 text-xs border border-gray-300 text-gray-700 px-3 py-2 rounded hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {docSyncState === 'creating' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlusCircle className="w-3.5 h-3.5" />
                  )}
                  Create new Google Doc
                </button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="url"
                  value={docLinkInput}
                  onChange={(e) => setDocLinkInput(e.target.value)}
                  placeholder="https://docs.google.com/document/d/..."
                  className="flex-1 text-xs border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  onKeyDown={(e) => e.key === 'Enter' && handleLinkGoogleDoc()}
                />
                <button
                  onClick={handleLinkGoogleDoc}
                  disabled={docSyncBusy || !docLinkInput.trim()}
                  className="text-xs bg-indigo-600 text-white px-3 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  {docSyncState === 'linking' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Link'}
                </button>
                <button
                  onClick={() => { setShowDocLinkInput(false); setDocLinkInput(''); }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-2"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {docSyncState === 'error' && docSyncError && (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {docSyncError}
          </div>
        )}
        {docSyncState === 'success' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            Done
          </div>
        )}
      </div>

      {/* Extracted Requirements */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-2">Call Brief</h2>
        <CallRequirementsPanel callAnalysis={callAnalysis} />
      </div>

      {/* Generate Skeleton */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onGenerateSkeleton}
          disabled={!grantIdea.trim() || generating}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate Skeleton
        </button>
      </div>
      </div>
    </div>
  );
}
