'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { streamEditorChat, streamWritingChat, ai } from '@/lib/api';
import {
  Send, Copy, CheckCheck, Plus, Sparkles, FileText,
  MousePointerClick, ChevronDown, AlertCircle, X, Wand2,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
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
}

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

function MarkdownText({ text }: { text: string }) {
  // Simple markdown rendering for chat messages
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="font-semibold text-gray-800 text-sm mt-2">{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={i} className="font-bold text-gray-900 text-sm mt-2">{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return <h1 key={i} className="font-bold text-gray-900 text-sm mt-2">{line.slice(2)}</h1>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="flex gap-1.5 text-xs"><span className="text-gray-400 mt-0.5">•</span><span>{renderInline(line.slice(2))}</span></div>;
        if (line.match(/^\d+\. /)) return <div key={i} className="flex gap-1.5 text-xs"><span className="text-gray-400 font-mono mt-0.5">{line.match(/^\d+/)?.[0]}.</span><span>{renderInline(line.replace(/^\d+\. /, ''))}</span></div>;
        if (line.startsWith('> ')) return <blockquote key={i} className="border-l-2 border-gray-300 pl-2 text-xs text-gray-600 italic">{renderInline(line.slice(2))}</blockquote>;
        if (line === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-xs leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[CUSTOMIZE:.*?\]|\[VERIFY:.*?\])/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="bg-gray-100 text-purple-700 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith('[CUSTOMIZE:')) return <span key={i} className="bg-amber-100 text-amber-700 px-1 rounded text-xs">{part}</span>;
    if (part.startsWith('[VERIFY:')) return <span key={i} className="bg-red-100 text-red-700 px-1 rounded text-xs">{part}</span>;
    return part;
  });
}

export default function AIChatPanel({
  grantId,
  selectedText,
  getDocumentContext,
  onInsertText,
  callRequirements,
  activeSection,
  writingPhase,
  useWritingStudio = false,
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm your grant writing assistant. I have access to:\n\n- **Your full document** as you write\n- **The RAG archive** of past grants and reusable language\n- **The call requirements** you've set\n\nSelect text in any section and I can improve it, or ask me to draft entire sections. What would you like to work on?`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [improveLoading, setImproveLoading] = useState(false);
  const [contextMode, setContextMode] = useState<'auto' | 'selection' | 'full'>('auto');
  const [contextChips, setContextChips] = useState<string[]>([]);
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

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text };
    const assistantId = genId();
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    // Build context based on mode
    const docContext = contextMode !== 'selection' ? getDocumentContext() : undefined;
    const selText = (contextMode !== 'full' && selectedText) ? selectedText : undefined;

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    abortRef.current = useWritingStudio
      ? streamWritingChat(
          grantId,
          {
            messages: history,
            document_context: docContext,
            selected_text: selText,
            active_section: activeSection,
            writing_phase: writingPhase,
          },
          (chunk, chips) => {
            if (chips) setContextChips(chips);
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          },
          () => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m)
            );
            setIsStreaming(false);
            abortRef.current = null;
          },
          (err) => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId
                ? { ...m, content: `Error: ${err}`, isStreaming: false }
                : m)
            );
            setIsStreaming(false);
            abortRef.current = null;
          },
        )
      : streamEditorChat(
          {
            grant_id: grantId,
            messages: history,
            document_context: docContext,
            selected_text: selText,
            active_section: activeSection,
          },
          (chunk) => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          },
          () => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m)
            );
            setIsStreaming(false);
            abortRef.current = null;
          },
          (err) => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId
                ? { ...m, content: `Error: ${err}`, isStreaming: false }
                : m)
            );
            setIsStreaming(false);
            abortRef.current = null;
          },
        );
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

  const clearChat = () => {
    setMessages([]);
  };

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
              <div className="text-xs font-semibold text-gray-800">Qwen AI Assistant</div>
              <div className="text-[10px] text-gray-400">Document-aware · RAG-powered</div>
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
              Call req. ✓
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
            <div className={`max-w-[92%] rounded-xl px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 border border-gray-100 text-gray-800'
            }`}>
              {msg.role === 'user' ? (
                <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div className="text-xs text-gray-800">
                  <MarkdownText text={msg.content} />
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-3.5 bg-purple-500 ml-0.5 animate-pulse rounded-sm" />
                  )}
                </div>
              )}
            </div>

            {/* Message actions (for assistant messages that are done) */}
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
              <div className="text-[10px] font-semibold text-amber-800 mb-1">Text selected</div>
              <div className="text-[10px] text-amber-700 truncate italic">
                "{selectedText.slice(0, 60)}{selectedText.length > 60 ? '...' : ''}"
              </div>
            </div>
          </div>
          <button
            onClick={handleImproveSelection}
            disabled={improveLoading}
            className="mt-2 w-full text-[10px] bg-amber-600 text-white rounded py-1.5 hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {improveLoading ? (
              <><span className="animate-spin">⟳</span> Improving...</>
            ) : (
              <><Wand2 className="w-3 h-3" /> Improve selection{input ? ` — "${input.slice(0, 20)}..."` : ''}</>
            )}
          </button>
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
            placeholder={selectedText ? 'Type an instruction for the selected text...' : 'Ask about the grant, request a draft, or ask for improvements...'}
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
          Enter to send · Shift+Enter for new line · RAG-powered
        </div>
      </div>
    </div>
  );
}
