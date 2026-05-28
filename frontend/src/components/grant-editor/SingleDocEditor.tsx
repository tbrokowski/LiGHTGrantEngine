'use client';
import { useEffect, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Node, type CommandProps, type RawCommands } from '@tiptap/core';

// Augment TipTap command types so insertPageBreak is type-safe on editor.chain()
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import {
  Bold, Italic, UnderlineIcon, Highlighter, List, ListOrdered,
  AlignLeft, AlignCenter, Heading2, Heading3, Quote, Scissors,
} from 'lucide-react';

// ── Page Break node ────────────────────────────────────────────────────────────
// Renders as a dashed divider with a label. atom:true means it is selected and
// deleted as a single unit (Backspace/Delete removes it).
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  renderHTML() {
    return [
      'div',
      {
        'data-type': 'page-break',
        contenteditable: 'false',
        style: [
          'border-top: 2px dashed #d1d5db',
          'margin: 20px 0 16px',
          'text-align: center',
          'color: #9ca3af',
          'font-size: 11px',
          'letter-spacing: 0.05em',
          'user-select: none',
          'pointer-events: none',
        ].join('; '),
      },
      '— Page Break —',
    ];
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name }),
    } as unknown as Partial<RawCommands>;
  },
});

interface SingleDocEditorProps {
  /** The canonical document HTML. Pass `initialHtml` on first render; update this prop to inject external content (AI insert, Docs pull). */
  documentHtml: string;
  onDocumentChange: (html: string, wordCount: number, headings: string[]) => void;
  onSelectionChange: (text: string) => void;
  onActiveSectionChange?: (sectionTitle: string) => void;
}

const DEBOUNCE_MS = 600;

function extractHeadings(editor: ReturnType<typeof useEditor>): string[] {
  if (!editor) return [];
  const doc = editor.getJSON();
  const heads: string[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = (node.content ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => (c.text as string | undefined) ?? '')
        .join('');
      if (text.trim()) heads.push(text.trim());
    }
  }
  return heads;
}

function detectActiveSection(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  const { from } = editor.state.selection;
  let active = '';
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs?.level === 2 && pos <= from) {
      active = node.textContent.trim();
    }
  });
  return active;
}

export default function SingleDocEditor({
  documentHtml,
  onDocumentChange,
  onSelectionChange,
  onActiveSectionChange,
}: SingleDocEditorProps) {
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHtml = useRef(documentHtml);
  const [selectionStats, setSelectionStats] = useState<{ words: number; chars: number } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      PageBreak,
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return 'Section title…';
          return 'Start writing, or ask the AI assistant to draft this section…';
        },
        emptyNodeClass: 'is-empty',
      }),
      CharacterCount,
      Typography,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: documentHtml || '',
    editorProps: {
      attributes: {
        class: [
          'prose prose-sm max-w-none focus:outline-none',
          'prose-headings:font-semibold prose-h2:text-base prose-h2:mt-8 prose-h2:mb-2',
          'prose-h2:border-b prose-h2:border-gray-200 prose-h2:pb-1',
          'prose-p:my-1',
          'text-gray-800',
        ].join(' '),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      if (html === lastHtml.current) return;
      lastHtml.current = html;
      const text = ed.getText();
      const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
      const heads = extractHeadings(ed);

      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => {
        onDocumentChange(html, words, heads);
      }, DEBOUNCE_MS);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from !== to) {
        const selected = ed.state.doc.textBetween(from, to, ' ');
        onSelectionChange(selected);
        const selWords = selected.trim() ? selected.trim().split(/\s+/).filter(Boolean).length : 0;
        setSelectionStats({ words: selWords, chars: selected.length });
      } else {
        onSelectionChange('');
        setSelectionStats(null);
      }
      onActiveSectionChange?.(detectActiveSection(ed));
    },
  });

  // Sync external content updates (e.g. pull from Google Docs, AI insert)
  useEffect(() => {
    if (!editor) return;
    // Only update TipTap if the prop changed externally (not due to our own onUpdate emission)
    if (documentHtml !== lastHtml.current) {
      lastHtml.current = documentHtml;
      editor.commands.setContent(documentHtml || '', { emitUpdate: false });
      const text = editor.getText();
      const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
      onDocumentChange(documentHtml, words, extractHeadings(editor));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentHtml, editor]);

  useEffect(() => {
    return () => { if (changeTimer.current) clearTimeout(changeTimer.current); };
  }, []);

  const ToolbarButton = useCallback(({
    onClick, active, title, children,
  }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className={`p-1.5 rounded text-xs transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  ), []);

  if (!editor) return null;

  const wordCount = editor.storage.characterCount?.words() ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-100">
      {/* Persistent formatting toolbar */}
      <div className="flex-shrink-0 flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 flex-wrap bg-white shadow-sm">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="Heading 2 (section)"
        >
          <Heading2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="Heading 3 (subsection)"
        >
          <Heading3 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline"
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive('highlight')}
          title="Highlight"
        >
          <Highlighter className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="Blockquote"
        >
          <Quote className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          title="Align left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          title="Align center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        <ToolbarButton
          onClick={() => editor.chain().focus().insertPageBreak().run()}
          active={false}
          title="Insert page break"
        >
          <Scissors className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="flex-1" />
        {/* Stats: show selection counts when text is highlighted, doc totals otherwise */}
        <div className="flex items-center gap-1.5 text-xs pr-1">
          {selectionStats ? (
            <>
              <span className="text-indigo-500 font-medium">
                {selectionStats.words.toLocaleString()} words · {selectionStats.chars.toLocaleString()} chars
              </span>
              <span className="text-gray-300">selected</span>
            </>
          ) : (
            <span className="text-gray-400">
              {wordCount.toLocaleString()} words · {(editor.storage.characterCount?.characters() ?? 0).toLocaleString()} chars
            </span>
          )}
        </div>
      </div>

      {/* Document content area — centered paper card on gray background */}
      <div className="flex-1 overflow-y-auto bg-gray-100 py-8">
        <div className="max-w-[800px] mx-auto bg-white shadow-sm rounded-sm px-14 py-12 min-h-[calc(100vh-12rem)]">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
