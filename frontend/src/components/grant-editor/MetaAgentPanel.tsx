'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Brain, Database, Globe, PenLine, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, MessageSquare,
  Sparkles, BarChart3,
} from 'lucide-react';

export interface MetaAgentEvent {
  event: string;
  section?: string;
  message?: string;
  tool?: string;
  query?: string;
  reason?: string;
  verdict?: string;
  question_id?: string;
  question?: string;
  why?: string;
  section_context?: string;
  // coherence_check
  overall?: string;
  issues?: Array<{ section: string; issue: string; severity: string }>;
  strengths?: string[];
}

export interface AgentQuestion {
  question_id: string;
  section: string;
  question: string;
  why: string;
  section_context?: string;
  answer?: string;
  skipped?: boolean;
}

interface MetaAgentPanelProps {
  events: MetaAgentEvent[];
  questions: AgentQuestion[];
  onAnswerQuestion: (questionId: string, answer: string) => void;
  onSkipQuestion: (questionId: string) => void;
  coherenceResult?: { overall: string; issues: Array<{ section: string; issue: string; severity: string }>; strengths: string[] } | null;
  visible: boolean;
}

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  search_rag_corpus: { icon: <Database className="w-3 h-3" />, label: 'Corpus search', color: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
  search_web:        { icon: <Globe className="w-3 h-3" />,    label: 'Web search',    color: 'text-blue-600 bg-blue-50 border-blue-100' },
  rewrite_section:   { icon: <PenLine className="w-3 h-3" />,  label: 'Rewriting',     color: 'text-purple-600 bg-purple-50 border-purple-100' },
  ask_user:          { icon: <MessageSquare className="w-3 h-3" />, label: 'Question', color: 'text-amber-600 bg-amber-50 border-amber-100' },
  accept_section:    { icon: <CheckCircle2 className="w-3 h-3" />, label: 'Accepted',  color: 'text-green-600 bg-green-50 border-green-100' },
};

function EventRow({ ev }: { ev: MetaAgentEvent }) {
  if (ev.event === 'meta_agent_thinking') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-0.5">
        <Brain className="w-3 h-3 text-gray-400 shrink-0" />
        <span>{ev.message || `Evaluating ${ev.section}…`}</span>
      </div>
    );
  }

  if (ev.event === 'meta_agent_action' && ev.tool && ev.tool !== 'ask_user') {
    const meta = TOOL_META[ev.tool] || { icon: <Sparkles className="w-3 h-3" />, label: ev.tool, color: 'text-gray-500 bg-gray-50 border-gray-100' };
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${meta.color}`}>
          {meta.icon} {meta.label}
        </span>
        {ev.query && (
          <span className="text-gray-500 truncate max-w-xs">{ev.query}</span>
        )}
        {ev.section && (
          <span className="text-gray-300 shrink-0">— {ev.section}</span>
        )}
      </div>
    );
  }

  if (ev.event === 'meta_agent_revision') {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 py-0.5">
        <PenLine className="w-3 h-3 text-green-500 shrink-0" />
        <span className="font-medium">Revised:</span>
        <span>{ev.section}</span>
        {ev.reason && <span className="text-green-500">— {ev.reason}</span>}
      </div>
    );
  }

  if (ev.event === 'meta_agent_accepted') {
    return (
      <div className="flex items-center gap-2 text-xs text-green-600 py-0.5">
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        <span className="font-medium">Accepted:</span>
        <span>{ev.section}</span>
        {ev.verdict && <span className="text-gray-400">— {ev.verdict}</span>}
      </div>
    );
  }

  return null;
}

export default function MetaAgentPanel({
  events,
  questions,
  onAnswerQuestion,
  onSkipQuestion,
  coherenceResult,
  visible,
}: MetaAgentPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new events arrive
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, collapsed]);

  if (!visible) return null;

  const pendingQuestions = questions.filter((q) => !q.answer && !q.skipped);
  const hasCoherenceIssues = (coherenceResult?.issues?.length ?? 0) > 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white text-xs">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 hover:bg-gray-100 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        <span className="font-semibold text-gray-700 flex-1 text-left text-xs">Meta-Agent Activity</span>
        {pendingQuestions.length > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-medium">
            <MessageSquare className="w-2.5 h-2.5" />
            {pendingQuestions.length} question{pendingQuestions.length > 1 ? 's' : ''}
          </span>
        )}
        {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
      </button>

      {!collapsed && (
        <div className="divide-y divide-gray-100">
          {/* Activity log */}
          {events.length > 0 && (
            <div
              ref={scrollRef}
              className="px-3 py-2 space-y-0.5 max-h-48 overflow-y-auto"
            >
              {events
                .filter((e) => e.event !== 'meta_agent_question')
                .map((ev, i) => (
                  <EventRow key={i} ev={ev} />
                ))}
            </div>
          )}

          {/* Coherence result */}
          {coherenceResult && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="font-semibold text-gray-600">Narrative coherence:</span>
                <span className={`font-medium capitalize ${
                  coherenceResult.overall === 'strong' ? 'text-green-600' :
                  coherenceResult.overall === 'weak' ? 'text-red-500' : 'text-amber-600'
                }`}>
                  {coherenceResult.overall}
                </span>
              </div>
              {hasCoherenceIssues && (
                <ul className="space-y-1 mt-1">
                  {coherenceResult.issues.slice(0, 4).map((issue, i) => (
                    <li key={i} className={`flex items-start gap-1.5 ${
                      issue.severity === 'high' ? 'text-red-600' :
                      issue.severity === 'medium' ? 'text-amber-600' : 'text-gray-500'
                    }`}>
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{issue.section !== 'global' ? <strong>{issue.section}:</strong> : null} {issue.issue}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(coherenceResult.strengths?.length ?? 0) > 0 && (
                <ul className="space-y-0.5 mt-1">
                  {coherenceResult.strengths!.slice(0, 2).map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-green-700">
                      <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Agent questions */}
          {pendingQuestions.length > 0 && (
            <div className="px-3 py-2 space-y-3">
              <p className="font-semibold text-amber-700 flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" />
                The agent needs your input to strengthen these sections:
              </p>
              {pendingQuestions.map((q) => (
                <div
                  key={q.question_id}
                  className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-2"
                >
                  <div>
                    <span className="font-medium text-amber-800">{q.section}:</span>{' '}
                    <span className="text-amber-900">{q.question}</span>
                  </div>
                  {q.why && (
                    <p className="text-amber-600 italic">{q.why}</p>
                  )}
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={answerDrafts[q.question_id] || ''}
                      onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [q.question_id]: e.target.value }))}
                      placeholder="Your answer…"
                      rows={2}
                      className="flex-1 text-xs border border-amber-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
                    />
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={!answerDrafts[q.question_id]?.trim()}
                        onClick={() => {
                          const ans = answerDrafts[q.question_id]?.trim();
                          if (ans) {
                            onAnswerQuestion(q.question_id, ans);
                            setAnswerDrafts((prev) => { const n = { ...prev }; delete n[q.question_id]; return n; });
                          }
                        }}
                        className="px-2.5 py-1 bg-amber-600 text-white rounded text-[10px] font-medium hover:bg-amber-700 disabled:opacity-40 transition-colors"
                      >
                        Answer
                      </button>
                      <button
                        type="button"
                        onClick={() => onSkipQuestion(q.question_id)}
                        className="px-2.5 py-1 bg-white text-amber-600 border border-amber-200 rounded text-[10px] hover:bg-amber-50 transition-colors"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
