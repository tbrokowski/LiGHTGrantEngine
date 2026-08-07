'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle, Check, Trash2, Send, ChevronDown, ChevronRight,
  X, RotateCw, Loader2, AlertTriangle, WifiOff, Sparkles, Wand2,
} from 'lucide-react';
import { grantComments, grants, type GrantComment } from '@/lib/api';
import { useWorkspace } from './WorkspaceContext';
import type { CommentBridge } from './editor-extensions';

interface Member { id: string; name: string }

interface CommentsPanelProps {
  grantId: string;
  /** "draft" for main editor, or the tab id for new-document panels */
  documentId?: string;
  onClose?: () => void;
  /** Pane-local bridge to the editor (highlight/locate). Only the draft editor sets it. */
  bridge?: React.MutableRefObject<CommentBridge>;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626',
  major: '#ea580c',
  minor: '#ca8a04',
  suggestion: '#2563eb',
};

export default function CommentsPanel({ grantId, documentId = 'draft', onClose, bridge }: CommentsPanelProps) {
  const { selectedText, onSelectionChange } = useWorkspace();
  const [comments, setComments] = useState<GrantComment[]>([]);
  const [newText, setNewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [driveScopeError, setDriveScopeError] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Review state
  const [reviewStatus, setReviewStatus] = useState<string>('idle');
  const [reviewSummary, setReviewSummary] = useState<Record<string, unknown> | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(true);
  const isDraft = documentId === 'draft';

  // @mention state
  const [members, setMembers] = useState<Member[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const pendingMentions = useRef<Set<string>>(new Set());

  const doSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError('');
    setDriveScopeError(false);
    try {
      const res = await grantComments.sync(grantId, documentId);
      setComments(res.data.comments);
      setLastSynced(new Date());
      if (res.data.sync_error) {
        setSyncError(res.data.sync_error);
        setDriveScopeError(res.data.drive_scope_error ?? false);
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ||
        (e as { message?: string }).message || 'Sync failed';
      setSyncError(msg);
    } finally {
      setSyncing(false);
    }
  }, [grantId, documentId, syncing]);

  // Initial load
  useEffect(() => { void doSync(); }, [grantId, documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sync every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void doSync();
    }, 30000);
    return () => clearInterval(interval);
  }, [doSync]);

  // Load assignable members for @mentions (draft only).
  useEffect(() => {
    if (!isDraft) return;
    grants.assignableMembers(grantId)
      .then((res) => {
        const list = (res.data as unknown[]).map((m) => {
          const r = m as Record<string, unknown>;
          return {
            id: String(r.user_id ?? r.id ?? ''),
            name: String(r.name ?? r.user_name ?? r.email ?? 'Member'),
          };
        }).filter((m) => m.id);
        setMembers(list);
      })
      .catch(() => {});
  }, [grantId, isDraft]);

  // Load current review status/summary once.
  useEffect(() => {
    if (!isDraft) return;
    grantComments.expertReviewStatus(grantId)
      .then((res) => { setReviewStatus(res.data.status); setReviewSummary(res.data.summary ?? null); })
      .catch(() => {});
  }, [grantId, isDraft]);

  // Focus textarea when text is selected
  useEffect(() => {
    if (selectedText && textareaRef.current) textareaRef.current.focus();
  }, [selectedText]);

  // Register the panel's focus-card handler so clicking a highlight in the doc
  // scrolls the matching comment card into view.
  useEffect(() => {
    if (!bridge) return;
    bridge.current.focusCard = (id: string) => {
      const el = cardRefs.current[id];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(id);
      window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
    };
    return () => { if (bridge.current) bridge.current.focusCard = undefined; };
  }, [bridge]);

  // Best-effort: highlight anchored comments in the document (esp. AI comments,
  // which are created server-side with a verbatim anchor but no editor mark yet).
  useEffect(() => {
    const api = bridge?.current.editor;
    if (!api) return;
    for (const c of comments) {
      if (!c.parent_id && c.anchor_text) api.locateAndMark(c.id, c.anchor_text);
    }
  }, [comments, bridge]);

  const detectMention = (value: string) => {
    const m = /@(\w*)$/.exec(value);
    if (m && isDraft) { setMentionOpen(true); setMentionQuery(m[1].toLowerCase()); }
    else setMentionOpen(false);
  };

  const pickMention = (member: Member) => {
    pendingMentions.current.add(member.id);
    setNewText((prev) => prev.replace(/@(\w*)$/, `@${member.name} `));
    setMentionOpen(false);
    textareaRef.current?.focus();
  };

  const handleAdd = async () => {
    if (!newText.trim()) return;
    setSubmitting(true);
    setSubmissionError('');
    try {
      const res = await grantComments.add(grantId, {
        text: newText.trim(),
        anchor_text: selectedText || undefined,
        document_id: documentId,
        mentions: Array.from(pendingMentions.current),
      });
      setComments((prev) => [...prev, res.data]);
      // Highlight the anchored passage in the document.
      if (selectedText) bridge?.current.editor?.applyCommentMark(res.data.id);
      setNewText('');
      pendingMentions.current.clear();
      setMentionOpen(false);
      if (selectedText) onSelectionChange('');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ||
        (e as { message?: string }).message || 'Failed to submit comment';
      setSubmissionError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (commentId: string) => {
    try {
      const res = await grantComments.update(grantId, commentId, { resolved: true });
      setComments((prev) => prev.map((c) => (c.id === commentId ? res.data : c)));
    } catch (e: unknown) {
      setSubmissionError((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to resolve');
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await grantComments.delete(grantId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      bridge?.current.editor?.removeCommentMark(commentId);
    } catch (e: unknown) {
      setSubmissionError((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to delete');
    }
  };

  const handleReply = async (parentId: string) => {
    const text = (replyTexts[parentId] || '').trim();
    if (!text) return;
    setReplyErrors((prev) => ({ ...prev, [parentId]: '' }));
    try {
      const res = await grantComments.add(grantId, { text, parent_id: parentId, document_id: documentId });
      setComments((prev) => [...prev, res.data]);
      setReplyTexts((prev) => ({ ...prev, [parentId]: '' }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to post reply';
      setReplyErrors((prev) => ({ ...prev, [parentId]: msg }));
    }
  };

  const focusInDoc = (c: GrantComment) => {
    if (c.anchor_text) bridge?.current.editor?.focusComment(c.id);
  };

  // ── Expert review ──────────────────────────────────────────────────────────
  const pollReview = useCallback(() => {
    const tick = async () => {
      try {
        const res = await grantComments.expertReviewStatus(grantId);
        setReviewStatus(res.data.status);
        if (res.data.status === 'running') { window.setTimeout(tick, 3000); return; }
        if (res.data.status === 'completed') {
          setReviewSummary(res.data.summary ?? null);
          setSummaryOpen(true);
          await doSync();
        } else if (res.data.status === 'failed') {
          setReviewError(res.data.error || 'Review failed');
        }
      } catch {
        window.setTimeout(tick, 4000);
      }
    };
    window.setTimeout(tick, 3000);
  }, [grantId, doSync]);

  const runReview = async () => {
    setReviewError('');
    try {
      setReviewStatus('running');
      await grantComments.startExpertReview(grantId);
      pollReview();
    } catch (e: unknown) {
      setReviewStatus('idle');
      setReviewError((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Could not start the review');
    }
  };

  const clearAiReview = async () => {
    try {
      await grantComments.clearAiReview(grantId, documentId);
      setReviewSummary(null);
      setReviewStatus('idle');
      // Drop AI comment marks + rows locally.
      comments.filter((c) => c.source === 'ai_reviewer').forEach((c) => bridge?.current.editor?.removeCommentMark(c.id));
      setComments((prev) => prev.filter((c) => c.source !== 'ai_reviewer'));
    } catch { /* no-op */ }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const topLevel = comments.filter((c) => !c.parent_id);
  const replies = (parentId: string) => comments.filter((c) => c.parent_id === parentId);
  const filteredMembers = members.filter((m) => m.name.toLowerCase().includes(mentionQuery)).slice(0, 6);
  const overall = (reviewSummary || {}) as Record<string, unknown>;
  const reviewing = reviewStatus === 'running';
  const hasAiComments = comments.some((c) => c.source === 'ai_reviewer');

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-semibold text-gray-800">Comments</span>
          {topLevel.length > 0 && (
            <span className="text-[10px] text-gray-400">{topLevel.filter((c) => !c.resolved).length} open</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {lastSynced && (
              <span className="text-[9px] text-gray-400 hidden sm:block" title={`Last synced: ${lastSynced.toLocaleTimeString()}`}>
                {lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={() => void doSync()} disabled={syncing} title="Sync from Google Doc"
              className="text-gray-400 hover:text-indigo-600 disabled:opacity-40 transition-colors">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            </button>
            {onClose && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" title="Close comments">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Expert reviewer control */}
        {isDraft && (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={() => void runReview()}
              disabled={reviewing}
              className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {reviewing ? 'Reviewing…' : 'Expert review'}
            </button>
            {hasAiComments && !reviewing && (
              <button onClick={() => void clearAiReview()} className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">
                Clear AI comments
              </button>
            )}
          </div>
        )}
        {reviewError && <p className="mt-1 text-[10px] text-red-600">{reviewError}</p>}

        {/* Sync error banner */}
        {syncError && (
          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            <WifiOff className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
            <span>
              {driveScopeError
                ? 'Google Docs comment sync failed — your Google account may need to be re-authorized with comment permissions.'
                : `Google Docs sync failed: ${syncError}`}
            </span>
          </div>
        )}
      </div>

      {/* AI review summary card */}
      {isDraft && reviewSummary && Boolean(overall.summary || overall.verdict) && (
        <div className="flex-shrink-0 mx-3 mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 text-xs">
          <button onClick={() => setSummaryOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-3 py-2 font-semibold text-indigo-800">
            <Wand2 className="w-3.5 h-3.5" />
            Reviewer verdict
            {typeof overall.score === 'number' && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-white text-indigo-700 text-[10px]">{overall.score as number}/100</span>
            )}
            {overall.verdict ? <span className="text-[10px] uppercase text-indigo-500 ml-1">{String(overall.verdict)}</span> : null}
            {summaryOpen ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {summaryOpen && (
            <div className="px-3 pb-2.5 space-y-1.5 text-gray-700">
              {overall.summary ? <p className="leading-relaxed">{String(overall.summary)}</p> : null}
              {Array.isArray(overall.strengths) && (overall.strengths as string[]).length > 0 && (
                <div><span className="font-semibold text-green-700">Strengths:</span>
                  <ul className="list-disc ml-4">{(overall.strengths as string[]).slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {Array.isArray(overall.risks) && (overall.risks as string[]).length > 0 && (
                <div><span className="font-semibold text-red-700">Risks:</span>
                  <ul className="list-disc ml-4">{(overall.risks as string[]).slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {topLevel.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center text-gray-400 gap-2">
            <MessageCircle className="w-8 h-8 text-gray-200" />
            <p className="text-xs">No comments yet. Highlight text to anchor a comment, or run an expert review.</p>
          </div>
        )}

        {topLevel.map((comment) => {
          const threadReplies = replies(comment.id);
          const isExpanded = expandedIds.has(comment.id);
          const isAi = comment.source === 'ai_reviewer';
          const sevColor = comment.severity ? SEVERITY_COLOR[comment.severity] : undefined;
          const flashing = highlightId === comment.id;

          return (
            <div
              key={comment.id}
              ref={(el) => { cardRefs.current[comment.id] = el; }}
              onClick={() => focusInDoc(comment)}
              className={`rounded-lg border text-xs cursor-pointer transition-shadow ${
                comment.resolved ? 'border-gray-100 bg-gray-50 opacity-60'
                : isAi ? 'border-indigo-200 bg-white' : 'border-indigo-100 bg-indigo-50/30'
              } ${flashing ? 'ring-2 ring-amber-400' : ''}`}
              style={sevColor ? { borderLeft: `3px solid ${sevColor}` } : undefined}
            >
              <div className="flex items-start gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  {isAi && (
                    <div className="flex items-center gap-1 mb-1">
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        <Sparkles className="w-2.5 h-2.5" /> Reviewer
                      </span>
                      {comment.severity && (
                        <span className="text-[9px] font-medium uppercase" style={{ color: sevColor }}>{comment.severity}</span>
                      )}
                    </div>
                  )}
                  {comment.anchor_text && (
                    <p className="text-[10px] text-indigo-600 italic border-l-2 border-indigo-300 pl-1.5 mb-1 truncate">
                      &ldquo;{comment.anchor_text.slice(0, 60)}{comment.anchor_text.length > 60 ? '…' : ''}&rdquo;
                    </p>
                  )}
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{comment.text}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(comment.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!comment.resolved && (
                    <button onClick={() => void handleResolve(comment.id)} title="Resolve"
                      className="p-0.5 text-gray-300 hover:text-green-500 transition-colors">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => void handleDelete(comment.id)} title="Delete"
                    className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {(threadReplies.length > 0 || !comment.resolved) && (
                <div className="border-t border-gray-100 px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                  {threadReplies.length > 0 && (
                    <button onClick={() => toggleExpand(comment.id)}
                      className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 mb-1">
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}
                    </button>
                  )}
                  {isExpanded && threadReplies.map((reply) => (
                    <div key={reply.id} className="ml-3 border-l-2 border-gray-200 pl-2 mb-2">
                      <p className="text-[10px] text-gray-600 leading-relaxed">{reply.text}</p>
                      <p className="text-[10px] text-gray-300 mt-0.5">
                        {new Date(reply.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                  {!comment.resolved && (
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1.5">
                        <input type="text" value={replyTexts[comment.id] || ''}
                          onChange={(e) => setReplyTexts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleReply(comment.id); }}
                          placeholder="Reply…"
                          className="flex-1 text-[11px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                        <button onClick={() => void handleReply(comment.id)} disabled={!(replyTexts[comment.id] || '').trim()}
                          className="p-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-40 transition-colors">
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                      {replyErrors[comment.id] && <p className="text-[10px] text-red-500">{replyErrors[comment.id]}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New comment input */}
      <div className="flex-shrink-0 p-3 border-t border-gray-100 relative">
        {selectedText && (
          <div className="mb-2 flex items-start gap-1.5">
            <div className="flex-1 text-[10px] text-indigo-600 italic border-l-2 border-indigo-300 pl-2 truncate">
              Commenting on: &ldquo;{selectedText.slice(0, 80)}{selectedText.length > 80 ? '…' : ''}&rdquo;
            </div>
            <button onClick={() => onSelectionChange('')} className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 mt-0.5" title="Clear selection">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {/* @mention dropdown */}
        {mentionOpen && filteredMembers.length > 0 && (
          <div className="absolute bottom-[76px] left-3 right-3 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 max-h-40 overflow-y-auto">
            {filteredMembers.map((m) => (
              <button key={m.id} onClick={() => pickMention(m)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 text-gray-700">
                @{m.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 rounded-lg border border-gray-200 focus-within:border-indigo-300 bg-white">
          <textarea ref={textareaRef} value={newText}
            onChange={(e) => { setNewText(e.target.value); detectMention(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) { e.preventDefault(); void handleAdd(); } }}
            placeholder={selectedText ? 'Comment on selected text… (@ to mention)' : 'Add a comment… (@ to mention)'}
            rows={2}
            className="flex-1 text-xs resize-none border-0 bg-transparent p-2 focus:outline-none placeholder-gray-400" />
          <button onClick={() => void handleAdd()} disabled={!newText.trim() || submitting}
            className="self-end m-1.5 p-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
        {submissionError && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>{submissionError}</span>
            <button onClick={() => setSubmissionError('')} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
          </div>
        )}
        <p className="text-[10px] text-gray-300 mt-1">Enter to send · Shift+Enter for new line · @ to mention</p>
      </div>
    </div>
  );
}
