'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { ai } from '@/lib/api';

interface ReviewFix {
  section?: string;
  issue?: string;
  suggestion?: string;
  severity?: string;
  source?: string;
}

interface ReviewReport {
  overall_score?: number;
  ready_for_submission?: boolean;
  compliance?: { overall_status?: string; critical_blockers?: string[]; recommended_fixes?: string[] };
  quality?: { overall_score?: number; criteria_scores?: Array<{ criterion: string; score: number; suggestions?: string }> };
  style?: { match_score?: number; deviations?: ReviewFix[] };
  prioritized_fixes?: ReviewFix[];
}

interface ReviewPanelProps {
  grantId: string;
  report: ReviewReport | null;
  loading: boolean;
  onRunReview: () => void;
  onApplyFix?: (fix: ReviewFix) => void;
  documentContext?: string;
}

export default function ReviewPanel({
  grantId,
  report,
  loading,
  onRunReview,
  onApplyFix,
  documentContext,
}: ReviewPanelProps) {
  const [expanded, setExpanded] = useState<string | null>('fixes');
  const [applying, setApplying] = useState<number | null>(null);

  const handleApply = async (fix: ReviewFix, index: number) => {
    if (!fix.suggestion || !onApplyFix) return;
    setApplying(index);
    try {
      const res = await ai.improveSelection({
        grant_id: grantId,
        selected_text: fix.issue || '',
        instruction: `Apply this fix: ${fix.suggestion}`,
        section_name: fix.section,
        document_context: documentContext,
      });
      onApplyFix({ ...fix, suggestion: res.data.improved_text });
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Review</span>
        <button
          onClick={onRunReview}
          disabled={loading}
          className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Run Review
        </button>
      </div>

      {!report && !loading && (
        <div className="flex-1 flex items-center justify-center p-4 text-xs text-gray-400 text-center">
          Run a multi-agent review to check compliance, quality, and style alignment.
        </div>
      )}

      {report && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
            <div className="text-2xl font-bold text-indigo-600">{report.overall_score ?? '—'}</div>
            <div>
              <div className="text-xs font-medium text-gray-800">Overall Score</div>
              <div className="flex items-center gap-1 text-[10px] mt-0.5">
                {report.ready_for_submission ? (
                  <><CheckCircle className="w-3 h-3 text-green-500" /><span className="text-green-600">Ready for submission</span></>
                ) : (
                  <><AlertTriangle className="w-3 h-3 text-amber-500" /><span className="text-amber-600">Needs work</span></>
                )}
              </div>
            </div>
          </div>

          <ReviewSection
            title="Compliance"
            expanded={expanded === 'compliance'}
            onToggle={() => setExpanded(expanded === 'compliance' ? null : 'compliance')}
          >
            <div className="text-xs text-gray-600">
              Status: <span className="font-medium">{report.compliance?.overall_status || 'unknown'}</span>
            </div>
            {(report.compliance?.critical_blockers || []).map((b, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">• {b}</div>
            ))}
          </ReviewSection>

          <ReviewSection
            title="Quality"
            expanded={expanded === 'quality'}
            onToggle={() => setExpanded(expanded === 'quality' ? null : 'quality')}
          >
            {(report.quality?.criteria_scores || []).map((c, i) => (
              <div key={i} className="text-xs flex justify-between py-0.5 border-b border-gray-50">
                <span className="text-gray-600 truncate mr-2">{c.criterion}</span>
                <span className="font-medium text-indigo-600 shrink-0">{c.score}/5</span>
              </div>
            ))}
          </ReviewSection>

          <ReviewSection
            title="Style"
            expanded={expanded === 'style'}
            onToggle={() => setExpanded(expanded === 'style' ? null : 'style')}
          >
            <div className="text-xs text-gray-600 mb-1">
              Match score: <span className="font-medium">{report.style?.match_score ?? '—'}/100</span>
            </div>
          </ReviewSection>

          <ReviewSection
            title={`Fixes (${(report.prioritized_fixes || []).length})`}
            expanded={expanded === 'fixes'}
            onToggle={() => setExpanded(expanded === 'fixes' ? null : 'fixes')}
          >
            {(report.prioritized_fixes || []).map((fix, i) => (
              <div key={i} className="text-xs border border-gray-100 rounded p-2 mb-1.5">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                    fix.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>{fix.severity || 'medium'}</span>
                  {fix.section && <span className="text-gray-500">{fix.section}</span>}
                  {fix.source && <span className="text-gray-400 ml-auto">{fix.source}</span>}
                </div>
                <div className="text-gray-700">{fix.issue || fix.suggestion}</div>
                {fix.suggestion && fix.issue && (
                  <div className="text-gray-500 mt-0.5 italic">{fix.suggestion}</div>
                )}
                {onApplyFix && fix.suggestion && (
                  <button
                    onClick={() => handleApply(fix, i)}
                    disabled={applying === i}
                    className="mt-1 text-[10px] text-indigo-600 hover:underline disabled:opacity-50"
                  >
                    {applying === i ? 'Applying...' : 'Apply fix'}
                  </button>
                )}
              </div>
            ))}
          </ReviewSection>
        </div>
      )}
    </div>
  );
}

function ReviewSection({
  title, expanded, onToggle, children,
}: { title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {title}
      </button>
      {expanded && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}
