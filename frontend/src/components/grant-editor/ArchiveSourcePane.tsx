'use client';

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, FileText } from 'lucide-react';
import { archive } from '@/lib/api';

interface ArchiveSourcePaneProps {
  sectionId: string;
}

interface ArchiveSection {
  id: string;
  archive_id: string | null;
  archive_title: string | null;
  grant_title: string | null;
  funder: string | null;
  year: number | null;
  outcome: string | null;
  section_type: string;
  section_title: string | null;
  section_text: string;
  word_count: number | null;
}

export default function ArchiveSourcePane({ sectionId }: ArchiveSourcePaneProps) {
  const [section, setSection] = useState<ArchiveSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    archive.getSection(sectionId)
      .then((res) => { if (!cancelled) setSection(res.data); })
      .catch((err) => {
        if (cancelled) return;
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || 'Failed to load archive source.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sectionId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading source…
      </div>
    );
  }

  if (error || !section) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <AlertCircle className="w-8 h-8 text-red-300" />
        <p className="text-sm text-gray-500">{error || 'Archive source not found.'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-shrink-0 border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
          <FileText className="w-3.5 h-3.5" />
          Archive source — {section.section_type}
        </div>
        <div className="text-sm font-semibold text-gray-800">
          {section.archive_title || section.grant_title || 'Untitled proposal'}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
          {section.funder && <span>Funder: {section.funder}</span>}
          {section.outcome && <span>Outcome: {section.outcome}</span>}
          {section.year && <span>Year: {section.year}</span>}
          {section.word_count != null && <span>{section.word_count.toLocaleString()} words</span>}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">
          {section.section_text}
        </pre>
      </div>
    </div>
  );
}
