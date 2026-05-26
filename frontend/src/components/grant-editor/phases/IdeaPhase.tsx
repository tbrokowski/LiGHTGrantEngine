'use client';

import { useRef, useState } from 'react';
import { Upload, Mic, MicOff, Loader2, Sparkles } from 'lucide-react';
import { grantWriting } from '@/lib/api';
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

interface IdeaPhaseProps {
  grantId: string;
  grantIdea: string;
  callAnalysis: Record<string, unknown>;
  stylePreview?: Array<Record<string, unknown>>;
  onIdeaChange: (idea: string) => void;
  onCallAnalysis: (analysis: Record<string, unknown>, requirements?: string) => void;
  onGenerateSkeleton: () => void;
  generating: boolean;
}

export default function IdeaPhase({
  grantId,
  grantIdea,
  callAnalysis,
  onIdeaChange,
  onCallAnalysis,
  onGenerateSkeleton,
  generating,
}: IdeaPhaseProps) {
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await grantWriting.uploadCall(grantId, file);
      onCallAnalysis(res.data.call_analysis || {}, res.data.call_requirements);
    } finally {
      setUploading(false);
    }
  };

  const toggleVoice = () => {
    const win = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) return;

    if (listening) {
      setListening(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      onIdeaChange(grantIdea ? `${grantIdea}\n${transcript}` : transcript);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6">
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

      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Call Document</h2>
        <p className="text-xs text-gray-500 mb-3">
          Upload the grant call PDF or DOCX — requirements will be extracted automatically.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 text-sm border border-dashed border-gray-300 rounded-lg px-4 py-3 w-full hover:border-indigo-400 hover:bg-indigo-50 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> : <Upload className="w-4 h-4 text-gray-400" />}
          <span className="text-gray-600">{uploading ? 'Analyzing call document...' : 'Upload call document (PDF, DOCX)'}</span>
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-2">Extracted Requirements</h2>
        <CallRequirementsPanel callAnalysis={callAnalysis} />
      </div>

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
  );
}
