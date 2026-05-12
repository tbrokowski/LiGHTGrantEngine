'use client';
import { useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import type { EditorSection } from '@/app/grants/[id]/page';
import {
  Bold, Italic, UnderlineIcon, Highlighter, List, ListOrdered,
  AlignLeft, AlignCenter, Heading2, Heading3, Quote,
} from 'lucide-react';

interface SectionEditorProps {
  section: EditorSection;
  isActive: boolean;
  onFocus: () => void;
  onChange: (updates: Partial<EditorSection>) => void;
  onSelectionChange: (text: string) => void;
}

const DEBOUNCE_MS = 800;

export default function SectionEditor({
  section,
  isActive,
  onFocus,
  onChange,
  onSelectionChange,
}: SectionEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContent = useRef(section.content_html);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({
        placeholder: 'Start writing this section… or use the AI assistant on the right to draft it.',
        emptyNodeClass: 'is-empty',
      }),
      CharacterCount,
      Typography,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: section.content_html || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[120px] text-gray-800',
      },
    },
    onFocus: onFocus,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const text = editor.getText();

      if (html === lastContent.current) return;
      lastContent.current = html;

      const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onChange({ content_html: html, content_text: text, word_count: words });
      }, DEBOUNCE_MS);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) {
        onSelectionChange(editor.state.doc.textBetween(from, to, ' '));
      } else {
        onSelectionChange('');
      }
    },
  });

  // Sync external HTML updates (e.g. AI insertion) into the editor
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (section.content_html !== current && section.content_html !== lastContent.current) {
      lastContent.current = section.content_html;
      editor.commands.setContent(section.content_html || '', false);
    }
  }, [section.content_html, editor]);

  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  const ToolbarButton = useCallback(({
    onClick, active, title, children,
  }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className={`p-1.5 rounded text-xs transition-colors ${
        active ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  ), []);

  if (!editor) return null;

  const wordCount = editor.storage.characterCount?.words() ?? section.word_count ?? 0;

  return (
    <div className={`relative rounded-lg border transition-all ${
      isActive ? 'border-blue-300 shadow-sm' : 'border-gray-100'
    }`}>
      {/* Bubble menu for selected text */}
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 100 }}
        className="flex items-center gap-0.5 bg-gray-900 rounded-lg p-1 shadow-xl border border-gray-700"
      >
        <button
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
          className={`p-1.5 rounded text-xs text-white transition-colors ${editor.isActive('bold') ? 'bg-white/20' : 'hover:bg-white/10'}`}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
          className={`p-1.5 rounded text-xs text-white transition-colors ${editor.isActive('italic') ? 'bg-white/20' : 'hover:bg-white/10'}`}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHighlight().run(); }}
          className={`p-1.5 rounded text-xs text-white transition-colors ${editor.isActive('highlight') ? 'bg-yellow-400/30' : 'hover:bg-white/10'}`}
          title="Highlight (mark for AI)"
        >
          <Highlighter className="w-3.5 h-3.5 text-yellow-300" />
        </button>
        <div className="w-px h-4 bg-white/20 mx-0.5" />
        <span className="text-xs text-gray-400 px-1">AI can see selection →</span>
      </BubbleMenu>

      {/* Formatting toolbar (shows when section is active) */}
      {isActive && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 flex-wrap">
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })} title="Heading 2">
            <Heading2 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })} title="Heading 3">
            <Heading3 className="w-3.5 h-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-gray-200 mx-0.5" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')} title="Bold">
            <Bold className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')} title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive('underline')} title="Underline">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()}
            active={editor.isActive('highlight')} title="Highlight">
            <Highlighter className="w-3.5 h-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-gray-200 mx-0.5" />
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')} title="Bullet list">
            <List className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')} title="Numbered list">
            <ListOrdered className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')} title="Blockquote">
            <Quote className="w-3.5 h-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-gray-200 mx-0.5" />
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()}
            active={editor.isActive({ textAlign: 'left' })} title="Align left">
            <AlignLeft className="w-3.5 h-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()}
            active={editor.isActive({ textAlign: 'center' })} title="Align center">
            <AlignCenter className="w-3.5 h-3.5" />
          </ToolbarButton>
          <div className="flex-1" />
          <span className="text-xs text-gray-300 pr-1">{wordCount.toLocaleString()} words</span>
        </div>
      )}

      {/* Tiptap editor */}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>

      {/* Word count footer */}
      {!isActive && wordCount > 0 && (
        <div className="px-3 py-1 text-xs text-gray-300 text-right border-t border-gray-50">
          {wordCount.toLocaleString()} words
        </div>
      )}
    </div>
  );
}
