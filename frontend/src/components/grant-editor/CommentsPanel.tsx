'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Check, Trash2, Send, ChevronDown, ChevronRight, X, RotateCw, Loader2 } from 'lucide-react';
import { grantComments, type GrantComment } from '@/lib/api';
import { useWorkspace } from './WorkspaceContext';

interface CommentsPanelProps {
  grantId: string;
  /** "draft" for main editor, or the tab id for new-document panels */
  documentId?: string;
  onClose?: () => void;
}

export default function CommentsPanel({ grantId, documentId = 'draft', onClose }: CommentsPanelProps) {
  const { selectedText } = useWorkspace();
  const [comments, setComments] = useState<GrantComment[]>([]);
  const [newText, setNewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const doSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await grantComments.sync(grantId, documentId);
      setComments(res.data);
      setLastSynced(new Date());
    } catch { /* ignore */ } finally {
      setSyncing(false);
    }
  }, [grantId, documentId, syncing]);

  // Initial load via sync (gets Google Doc comments too, not just local)
  useEffect(() => { void doSync(); }, [grantId, documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sync every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void doSync();
    }, 30000);
    return () => clearInterval(interval);
  }, [doSync]);

  // When selected text changes, pre-fill the anchor in the textarea placeholder
  useEffect(() => {
    if (selectedText && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selectedText]);

  const handleAdd = async () => {
    if (!newText.trim()) return;
    setSubmitting(true);
    try {
      const res = await grantComments.add(grantId, {
        text: newText.trim(),
        anchor_text: selectedText || undefined,
        document_id: documentId,
      });
      setComments((prev) => [...prev, res.data]);
      setNewText('');
    } catch { /* ignore */ } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (commentId: string) => {
    try {
      const res = await grantComments.update(grantId, commentId, { resolved: true });
      setComments((prev) => prev.map((c) => c.id === commentId ? res.data : c));
    } catch { /* ignore */ }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await grantComments.delete(grantId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch { /* ignore */ }
  };

  const handleReply = async (parentId: string) => {
    const text = (replyTexts[parentId] || '').trim();
    if (!text) return;
    try {
      const res = await grantComments.add(grantId, { text, parent_id: parentId, document_id: documentId });
      setComments((prev) => [...prev, res.data]);
      setReplyTexts((prev) => ({ ...prev, [parentId]: '' }));
    } catch { /* ignore */ }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  // Separate top-level from replies
  const topLevel = comments.filter((c) => !c.parent_id);
  const replies = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

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
            <button
              onClick={() => void doSync()}
              disabled={syncing}
              title="Sync from Google Doc"
              className="text-gray-400 hover:text-indigo-600 disabled:opacity-40 transition-colors"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            </button>
            {onClose && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" title="Close comments">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {topLevel.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center text-gray-400 gap-2">
            <MessageCircle className="w-8 h-8 text-gray-200" />
            <p className="text-xs">No comments yet. Highlight text to anchor a comment.</p>
          </div>
        )}

        {topLevel.map((comment) => {
          const threadReplies = replies(comment.id);
          const isExpanded = expandedIds.has(comment.id);

          return (
            <div
              key={comment.id}
              className={`rounded-lg border text-xs ${
                comment.resolved
                  ? 'border-gray-100 bg-gray-50 opacity-60'
                  : 'border-indigo-100 bg-indigo-50/30'
              }`}
            >
              {/* Comment header */}
              <div className="flex items-start gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  {comment.anchor_text && (
                    <p className="text-[10px] text-indigo-600 italic border-l-2 border-indigo-300 pl-1.5 mb-1 truncate">
                      "{comment.anchor_text.slice(0, 60)}{comment.anchor_text.length > 60 ? '…' : ''}"
                    </p>
                  )}
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{comment.text}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(comment.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {!comment.resolved && (
                    <button
                      onClick={() => handleResolve(comment.id)}
                      title="Resolve"
                      className="p-0.5 text-gray-300 hover:text-green-500 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(comment.id)}
                    title="Delete"
                    className="p-0.5 text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Replies toggle */}
              {(threadReplies.length > 0 || !comment.resolved) && (
                <div className="border-t border-gray-100 px-3 py-1.5">
                  {threadReplies.length > 0 && (
                    <button
                      onClick={() => toggleExpand(comment.id)}
                      className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 mb-1"
                    >
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

                  {/* Reply box */}
                  {!comment.resolved && (
                    <div className="flex gap-1.5 mt-1">
                      <input
                        type="text"
                        value={replyTexts[comment.id] || ''}
                        onChange={(e) => setReplyTexts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleReply(comment.id); }}
                        placeholder="Reply…"
                        className="flex-1 text-[11px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                      <button
                        onClick={() => handleReply(comment.id)}
                        disabled={!(replyTexts[comment.id] || '').trim()}
                        className="p-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-40 transition-colors"
                      >
                        <Send className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New comment input */}
      <div className="flex-shrink-0 p-3 border-t border-gray-100">
        {selectedText && (
          <div className="mb-2 text-[10px] text-indigo-600 italic border-l-2 border-indigo-300 pl-2 truncate">
            Anchoring to: "{selectedText.slice(0, 60)}{selectedText.length > 60 ? '…' : ''}"
          </div>
        )}
        <div className="flex gap-2 rounded-lg border border-gray-200 focus-within:border-indigo-300 bg-white">
          <textarea
            ref={textareaRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAdd(); } }}
            placeholder={selectedText ? 'Comment on selected text…' : 'Add a comment…'}
            rows={2}
            className="flex-1 text-xs resize-none border-0 bg-transparent p-2 focus:outline-none placeholder-gray-400"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!newText.trim() || submitting}
            className="self-end m-1.5 p-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
        <p className="text-[10px] text-gray-300 mt-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
