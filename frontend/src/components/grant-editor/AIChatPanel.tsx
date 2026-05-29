'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { streamEditorChat, streamWritingChat, ai } from '@/lib/api';
import type { WritingChatEvent, ChatSource } from '@/lib/api';
import {
  Send, Copy, CheckCheck, Plus, Sparkles, FileText,
  MousePointerClick, ChevronDown, AlertCircle, X, Wand2, Loader2,
  BookOpen, Search, Database, Quote, FolderSearch, ExternalLink,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  sources?: ChatSource[];
  toolActivity?: ToolActivity[];
}

interface ToolActivity {
  tool: string;
  display: string;
  status: 'running' | 'done';
  count?: number;
}

interface AIChatPanelProps {
  grantId: string;
  selectedText: string;
  getDocumentContext: () => string;
  onInsertText: (text: string) => void;
  callRequirements: string;
  activeSection?: string;
  writingPhase?: string;
  useWritingStudio?: boolean;
  googleDocUrl?: string | null;
  activeDocLabel?: string;
}

// ── Quick prompts ─────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: 'Draft this section', prompt: 'Please draft the content for this section based on the grant requirements and any relevant prior work from our archive.' },
  { label: 'Improve writing', prompt: 'Please improve the writing quality of the current section content, making it more compelling and appropriate for this funder.' },
  { label: 'Make more concise', prompt: 'Please make the current section content more concise while preserving all key information.' },
  { label: 'Add more detail', prompt: 'Please expand the current section with more detail, specific examples, and stronger evidence.' },
  { label: 'Check alignment', prompt: 'Please check how well the current section aligns with the call requirements and evaluation criteria, and suggest improvements.' },
  { label: 'Similar past grants', prompt: 'What similar sections have we written for past grants? Summarize the key approaches and language we used.' },
  { label: 'Strengthen impact', prompt: 'How can we strengthen the impact statement and make this more compelling to the funder?' },
  { label: 'Compliance check', prompt: 'Check the current section for compliance with the call requirements and flag any gaps or missing elements.' },
];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Tool activity icons ───────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ElementType> = {
  search_archive: Database,
  lookup_opportunity: Search,
  search_citations: BookOpen,
  find_citation_for_text: Quote,
  search_org_docs: FolderSearch,
};

function ToolActivityRow({ activities }: { activities: ToolActivity[] }) {
  if (!activities.length) return null;
  return (
    <div className="space-y-0.5 mb-1.5">
      {activities.map((act, i) => {
        const Icon = TOOL_ICONS[act.tool] || Search;
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">
            {act.status === 'running' ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
            ) : (
              <Icon className="w-2.5 h-2.5 shrink-0 text-indigo-500" />
            )}
            <span className="truncate flex-1">{act.display}</span>
            {act.status === 'done' && act.count !== undefined && (
              <span className="shrink-0 text-indigo-400">{act.count} result{act.count !== 1 ? 's' : ''}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Citation badge (inline [N] references) ────────────────────────────────────

function CitationBadge({ index, source }: { index: number; source: ChatSource | undefined }) {
  const [open, setOpen] = useState(false);
  if (!source) {
    return <span className="text-[10px] text-gray-400">[{index}]</span>;
  }
  const typeColors: Record<string, string> = {
    citation: 'bg-blue-50 text-blue-600 border-blue-200',
    opportunity: 'bg-green-50 text-green-600 border-green-200',
    archive: 'bg-purple-50 text-purple-600 border-purple-200',
    document: 'bg-amber-50 text-amber-600 border-amber-200',
  };
  const badgeClass = typeColors[source.type] || 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center text-[10px] border rounded px-1 py-0 cursor-pointer hover:opacity-80 transition-opacity ${badgeClass}`}
      >
        [{index}]
      </button>
      {open && (
        <div
          className="absolute bottom-5 left-0 z-50 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 text-xs"
          onMouseLeave={() => setOpen(false)}
        >
          <p className="font-medium text-gray-800 leading-tight mb-0.5 line-clamp-2">{source.title}</p>
          {source.meta && <p className="text-[10px] text-gray-500 mb-1">{source.meta}</p>}
          {source.snippet && <p className="text-[10px] text-gray-600 italic line-clamp-3">{source.snippet}</p>}
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-indigo-600 hover:underline mt-1.5"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              Open source
            </a>
          )}
          {source.formatted_citation && (
            <p className="text-[10px] text-gray-500 mt-1 border-t border-gray-100 pt-1 leading-relaxed">
              {source.formatted_citation}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

// ── Sources panel below assistant messages ────────────────────────────────────

function SourcesPanel({ sources }: { sources: ChatSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!sources.length) return null;

  const typeIcon: Record<string, React.ElementType> = {
    citation: BookOpen,
    opportunity: Search,
    archive: Database,
    document: FileText,
  };
  const typeLabel: Record<string, string> = {
    citation: 'Literature',
    opportunity: 'Opportunity',
    archive: 'Archive',
    document: 'Document',
  };

  return (
    <div className="mt-1.5 text-[10px]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 transition-colors"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? '' : '-rotate-90'}`} />
        Sources ({sources.length})
      </button>
      {expanded && (
        <div className="mt-1 space-y-1.5 border border-gray-100 rounded-lg p-2 bg-gray-50">
          {sources.map((s, i) => {
            const Icon = typeIcon[s.type] || FileText;
            return (
              <div key={i} className="flex gap-1.5">
                <span className="shrink-0 text-gray-400 font-mono pt-0.5">[{i + 1}]</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Icon className="w-2.5 h-2.5 text-gray-400 shrink-0" />
                    <span className="font-medium text-gray-700 truncate flex-1">{s.title}</span>
                    <span className="text-gray-400 shrink-0">{typeLabel[s.type] || s.type}</span>
                  </div>
                  {s.meta && <p className="text-gray-400 leading-relaxed">{s.meta}</p>}
                  {s.snippet && <p className="text-gray-500 italic leading-relaxed line-clamp-2">{s.snippet}</p>}
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-500 hover:underline inline-flex items-center gap-0.5"
                    >
                      <ExternalLink className="w-2 h-2" />
                      Open
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Markdown + inline citation rendering ──────────────────────────────────────

function MarkdownText({ text, sources }: { text: string; sources?: ChatSource[] }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="font-semibold text-gray-800 text-sm mt-2">{renderLineWithCitations(line.slice(4), sources)}</h3>;
        if (line.startsWith('## ')) return <h2 key={i} className="font-bold text-gray-900 text-sm mt-2">{renderLineWithCitations(line.slice(3), sources)}</h2>;
        if (line.startsWith('# ')) return <h1 key={i} className="font-bold text-gray-900 text-sm mt-2">{renderLineWithCitations(line.slice(2), sources)}</h1>;
        if (line.startsWith('- ') || line.startsWith('* ')) return (
          <div key={i} className="flex gap-1.5 text-xs">
            <span className="text-gray-400 mt-0.5 shrink-0">•</span>
            <span>{renderLineWithCitations(line.slice(2), sources)}</span>
          </div>
        );
        if (line.match(/^\d+\. /)) return (
          <div key={i} className="flex gap-1.5 text-xs">
            <span className="text-gray-400 font-mono mt-0.5 shrink-0">{line.match(/^\d+/)?.[0]}.</span>
            <span>{renderLineWithCitations(line.replace(/^\d+\. /, ''), sources)}</span>
          </div>
        );
        if (line.startsWith('> ')) return (
          <blockquote key={i} className="border-l-2 border-gray-300 pl-2 text-xs text-gray-600 italic">
            {renderLineWithCitations(line.slice(2), sources)}
          </blockquote>
        );
        if (line === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-xs leading-relaxed">{renderLineWithCitations(line, sources)}</p>;
      })}
    </div>
  );
}

function renderLineWithCitations(text: string, sources?: ChatSource[]): React.ReactNode {
  // Split on inline patterns: **bold**, *italic*, `code`, [CUSTOMIZE:], [VERIFY:], [N] citation refs
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[CUSTOMIZE:.*?\]|\[VERIFY:.*?\]|\[\d+\])/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return (
      <code key={i} className="bg-gray-100 text-purple-700 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>
    );
    if (part.startsWith('[CUSTOMIZE:')) return (
      <span key={i} className="bg-amber-100 text-amber-700 px-1 rounded text-xs">{part}</span>
    );
    if (part.startsWith('[VERIFY:')) return (
      <span key={i} className="bg-red-100 text-red-700 px-1 rounded text-xs">{part}</span>
    );
    // Citation reference like [1], [2], etc.
    const citMatch = part.match(/^\[(\d+)\]$/);
    if (citMatch && sources) {
      const idx = parseInt(citMatch[1], 10);
      return <CitationBadge key={i} index={idx} source={sources[idx - 1]} />;
    }
    return part;
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AIChatPanel({
  grantId,
  selectedText,
  getDocumentContext,
  onInsertText,
  callRequirements,
  activeSection,
  writingPhase,
  useWritingStudio = false,
  googleDocUrl,
  activeDocLabel = 'Draft',
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm your grant writing assistant. I can now:\n\n- **Look up any opportunity** by name ("Tell me about MOOVE")\n- **Search the archive** of past funded grants for examples\n- **Find citations** for any highlighted text — just select it and click "Find Citation"\n- **Search academic literature** on any topic\n\nSelect text in any section and I can improve it, find citations, or help draft new content. What would you like to work on?`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [improveLoading, setImproveLoading] = useState(false);
  const [insertingToDoc, setInsertingToDoc] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<'auto' | 'selection' | 'full'>('auto');
  const [contextChips, setContextChips] = useState<string[]>([]);

  // Active tool activity for the currently streaming message
  const activeToolsRef = useRef<ToolActivity[]>([]);
  // Active message ID being streamed
  const streamingMsgIdRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (overrideInput?: string) => {
    const text = (overrideInput ?? input).trim();
    if (!text || isStreaming) return;

    setInput('');
    setShowQuickPrompts(false);
    activeToolsRef.current = [];

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text };
    const assistantId = genId();
    streamingMsgIdRef.current = assistantId;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      toolActivity: [],
      sources: [],
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const docContext = contextMode !== 'selection' ? getDocumentContext() : undefined;
    const selText = (contextMode !== 'full' && selectedText) ? selectedText : undefined;
    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    const handleEvent = (event: WritingChatEvent) => {
      const msgId = streamingMsgIdRef.current;
      if (!msgId) return;

      if (event.type === 'tool_start') {
        const newAct: ToolActivity = { tool: event.tool!, display: event.display || event.tool!, status: 'running' };
        activeToolsRef.current = [...activeToolsRef.current, newAct];
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, toolActivity: [...activeToolsRef.current] } : m)
        );
      } else if (event.type === 'tool_result') {
        activeToolsRef.current = activeToolsRef.current.map(a =>
          a.tool === event.tool ? { ...a, status: 'done', count: event.count } : a
        );
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, toolActivity: [...activeToolsRef.current] } : m)
        );
      } else if (event.type === 'content' && event.content) {
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, content: m.content + event.content! } : m)
        );
      } else if (event.type === 'sources' && event.items) {
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, sources: event.items } : m)
        );
      } else if (event.type === 'context_chips' && event.chips) {
        setContextChips(event.chips);
      }
    };

    const handleDone = () => {
      setMessages(prev =>
        prev.map(m => m.id === streamingMsgIdRef.current
          ? { ...m, isStreaming: false }
          : m)
      );
      setIsStreaming(false);
      streamingMsgIdRef.current = null;
      activeToolsRef.current = [];
      abortRef.current = null;
    };

    const handleError = (err: string) => {
      setMessages(prev =>
        prev.map(m => m.id === streamingMsgIdRef.current
          ? { ...m, content: `Error: ${err}`, isStreaming: false }
          : m)
      );
      setIsStreaming(false);
      streamingMsgIdRef.current = null;
      abortRef.current = null;
    };

    if (useWritingStudio) {
      abortRef.current = streamWritingChat(
        grantId,
        {
          messages: history,
          document_context: docContext,
          selected_text: selText,
          active_section: activeSection,
          writing_phase: writingPhase,
        },
        handleEvent,
        handleDone,
        handleError,
      );
    } else {
      // Legacy editor chat (no tools) — adapt to new signature by mapping chunk to content event
      abortRef.current = streamEditorChat(
        {
          grant_id: grantId,
          messages: history,
          document_context: docContext,
          selected_text: selText,
          active_section: activeSection,
        },
        (chunk: string) => handleEvent({ type: 'content', content: chunk }),
        handleDone,
        handleError,
      );
    }
  }, [input, isStreaming, messages, grantId, selectedText, getDocumentContext, contextMode, activeSection, writingPhase, useWritingStudio]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  };

  const copyMessage = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const insertToGoogleDoc = async (msgId: string) => {
    if (!googleDocUrl || insertingToDoc) return;
    setInsertingToDoc(msgId);
    try {
      const { grants } = await import('@/lib/api');
      await grants.pushToGoogleDoc(grantId);
    } catch {
      if (googleDocUrl) window.open(googleDocUrl, '_blank');
    } finally {
      setInsertingToDoc(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleImproveSelection = async () => {
    if (!selectedText || improveLoading) return;
    const instruction = input.trim() || 'Improve this text to be more compelling and academically rigorous.';
    setImproveLoading(true);
    setInput('');
    try {
      const res = await ai.improveSelection({
        grant_id: grantId,
        selected_text: selectedText,
        instruction,
        document_context: getDocumentContext(),
      });
      const improvedId = genId();
      setMessages(prev => [
        ...prev,
        { id: genId(), role: 'user', content: `Improve selection: "${selectedText.slice(0, 80)}${selectedText.length > 80 ? '...' : ''}"\n\nInstruction: ${instruction}` },
        { id: improvedId, role: 'assistant', content: res.data.improved_text },
      ]);
    } catch (e: unknown) {
      setMessages(prev => [
        ...prev,
        { id: genId(), role: 'assistant', content: `Failed to improve: ${(e as Error).message}` },
      ]);
    } finally {
      setImproveLoading(false);
    }
  };

  const handleFindCitation = () => {
    if (!selectedText || isStreaming) return;
    sendMessage(`Find academic citations for this text:\n\n"${selectedText.slice(0, 400)}"`);
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-blue-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-gradient-to-br from-purple-600 to-blue-600 rounded flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-800">AI Writing Assistant</div>
              <div className="text-[10px] text-gray-400">Tools · RAG · Citations</div>
            </div>
          </div>
          <button onClick={clearChat} className="text-gray-400 hover:text-gray-600 p-1 rounded" title="Clear chat">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Context indicators */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <button
            onClick={() => setContextMode(contextMode === 'full' ? 'auto' : 'full')}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              contextMode === 'full'
                ? 'bg-blue-100 text-blue-700 border-blue-200'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
            title="Include full document in every message"
          >
            <FileText className="w-2.5 h-2.5" />
            Full Doc
          </button>

          <span
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100"
            title={`AI is reading: ${activeDocLabel}`}
          >
            <FileText className="w-2.5 h-2.5" />
            {activeDocLabel}
          </span>

          {selectedText && (
            <button
              onClick={() => setContextMode(contextMode === 'selection' ? 'auto' : 'selection')}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                contextMode === 'selection'
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-amber-50 text-amber-600 border-amber-200 hover:border-amber-300'
              }`}
              title="Focus AI on selected text only"
            >
              <MousePointerClick className="w-2.5 h-2.5" />
              {selectedText.slice(0, 20)}{selectedText.length > 20 ? '...' : ''} selected
            </button>
          )}

          {callRequirements && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100">
              <CheckCheck className="w-2.5 h-2.5" />
              Requirements loaded
            </span>
          )}
          {activeSection && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
              {activeSection}
            </span>
          )}
          {contextChips.map(chip => (
            <span key={chip} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100">
              {chip}
            </span>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            {/* Tool activity rows (above streaming message) */}
            {msg.role === 'assistant' && msg.toolActivity && msg.toolActivity.length > 0 && (
              <div className="w-full max-w-[92%]">
                <ToolActivityRow activities={msg.toolActivity} />
              </div>
            )}

            {/* Message bubble */}
            <div className={`max-w-[92%] rounded-xl px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 border border-gray-100 text-gray-800'
            }`}>
              {msg.role === 'user' ? (
                <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div className="text-xs text-gray-800">
                  <MarkdownText text={msg.content} sources={msg.sources} />
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-3.5 bg-purple-500 ml-0.5 animate-pulse rounded-sm" />
                  )}
                </div>
              )}
            </div>

            {/* Sources panel */}
            {msg.role === 'assistant' && !msg.isStreaming && msg.sources && msg.sources.length > 0 && (
              <div className="w-full max-w-[92%]">
                <SourcesPanel sources={msg.sources} />
              </div>
            )}

            {/* Message actions */}
            {msg.role === 'assistant' && !msg.isStreaming && msg.content && msg.id !== 'welcome' && (
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => copyMessage(msg.id, msg.content)}
                  className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
                  title="Copy"
                >
                  {copiedId === msg.id ? <CheckCheck className="w-2.5 h-2.5 text-green-500" /> : <Copy className="w-2.5 h-2.5" />}
                  {copiedId === msg.id ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => onInsertText(msg.content)}
                  className="flex items-center gap-1 text-[10px] text-purple-500 hover:text-purple-700 px-1.5 py-0.5 rounded hover:bg-purple-50 transition-colors"
                  title="Insert into active section"
                >
                  <Plus className="w-2.5 h-2.5" />
                  Insert into section
                </button>
                {googleDocUrl && (
                  <button
                    onClick={() => insertToGoogleDoc(msg.id)}
                    disabled={insertingToDoc === msg.id}
                    className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors disabled:opacity-50"
                    title="Push to Google Doc"
                  >
                    {insertingToDoc === msg.id ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <FileText className="w-2.5 h-2.5" />
                    )}
                    {insertingToDoc === msg.id ? 'Syncing…' : 'Push to Doc'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Selection quick-action banner */}
      {selectedText && !isStreaming && (
        <div className="flex-shrink-0 mx-3 mb-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <div className="flex items-start gap-2">
            <Wand2 className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold text-amber-800 mb-0.5">Text selected</div>
              <div className="text-[10px] text-amber-700 truncate italic">
                &ldquo;{selectedText.slice(0, 60)}{selectedText.length > 60 ? '…' : ''}&rdquo;
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={handleImproveSelection}
              disabled={improveLoading}
              className="flex-1 text-[10px] bg-amber-600 text-white rounded py-1.5 hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              {improveLoading ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Improving…</>
              ) : (
                <><Wand2 className="w-3 h-3" /> Improve</>
              )}
            </button>
            <button
              onClick={handleFindCitation}
              disabled={isStreaming}
              className="flex-1 text-[10px] bg-indigo-600 text-white rounded py-1.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              title="Find academic citations supporting this text"
            >
              <BookOpen className="w-3 h-3" />
              Find Citation
            </button>
          </div>
        </div>
      )}

      {/* Quick prompts */}
      {showQuickPrompts && (
        <div className="flex-shrink-0 mx-3 mb-2 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100 text-xs font-semibold text-gray-600 sticky top-0 bg-white">
            Quick prompts
          </div>
          {QUICK_PROMPTS.map(q => (
            <button
              key={q.label}
              onClick={() => sendMessage(q.prompt)}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-gray-50 last:border-0"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 p-3 border-t border-gray-100">
        <div className={`flex gap-2 rounded-xl border transition-all ${
          isStreaming ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200 bg-white focus-within:border-blue-300 focus-within:shadow-sm'
        }`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedText ? 'Type an instruction, or click Find Citation above…' : 'Ask about a grant, look up an opportunity, or request citations…'}
            rows={2}
            disabled={isStreaming && !abortRef.current}
            className="flex-1 text-xs resize-none border-0 bg-transparent p-2.5 focus:outline-none text-gray-800 placeholder-gray-400"
          />
          <div className="flex flex-col justify-end gap-1 p-2">
            <button
              onClick={() => setShowQuickPrompts(!showQuickPrompts)}
              title="Quick prompts"
              className={`p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ${showQuickPrompts ? 'bg-gray-100 text-gray-600' : ''}`}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showQuickPrompts ? 'rotate-180' : ''}`} />
            </button>
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                title="Stop generating"
              >
                <AlertCircle className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Send (Enter)"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="text-[10px] text-gray-300 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
