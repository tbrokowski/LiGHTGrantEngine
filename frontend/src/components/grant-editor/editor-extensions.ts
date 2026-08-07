import { Extension, Mark, mergeAttributes } from '@tiptap/core';

// Command types for the font-family / font-size setters below.
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineFontStyles: {
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

// Curated to match what Google Docs commonly offers, so pushed/pulled docs look
// the same. `value` is the CSS font-family stack written to inline style.
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Garamond', value: 'Garamond, serif' },
];

export const FONT_SIZES: string[] = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '18pt', '24pt', '30pt', '36pt'];

// Common text/highlight swatches (Google-Docs-ish palette).
export const TEXT_COLORS: string[] = [
  '#000000', '#434343', '#666666', '#980000', '#ff0000', '#ff9900',
  '#f1c232', '#38761d', '#0000ff', '#1155cc', '#674ea7', '#a64d79',
];
export const HIGHLIGHT_COLORS: string[] = [
  '#fff2cc', '#fce5cd', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9',
  '#ead1dc', '#fce8b2', '#f4cccc', '#ffff00',
];

// ── Comment mark ─────────────────────────────────────────────────────────────
// Wraps a range in <span data-comment-id="…" class="comment-highlight"> so a
// comment's anchor is highlighted in the document, persists in the saved HTML,
// and can be located/clicked. Overlaps with formatting marks (excludes: '').
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.commentId ? { 'data-comment-id': attrs.commentId } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-highlight' }), 0];
  },
});

/** Imperative handle the CommentsPanel uses to drive the editor. */
export interface CommentEditorApi {
  /** Mark the last non-empty selection with this comment id. */
  applyCommentMark: (id: string) => void;
  /** Remove the comment mark carrying this id. */
  removeCommentMark: (id: string) => void;
  /** Scroll the highlight for this id into view and flash it. */
  focusComment: (id: string) => void;
  /** Find `anchorText` in the doc and mark it with this id. Returns true if found. */
  locateAndMark: (id: string, anchorText: string) => boolean;
}

/** Shared, pane-local bridge between the editor and its comments panel. */
export interface CommentBridge {
  editor?: CommentEditorApi | null;
  focusCard?: (id: string) => void;
}


// ── Inline font style extension ─────────────────────────────────────────────
// Adds fontSize + fontFamily attributes to the textStyle mark so Google Docs
// exported HTML (inline CSS) round-trips, and exposes set/unset commands the
// toolbar uses. Requires @tiptap/extension-text-style (for removeEmptyTextStyle).
export const InlineFontStyles = Extension.create({
  name: 'inlineFontStyles',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: Element) => (el as HTMLElement).style.fontSize || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
          fontFamily: {
            default: null,
            parseHTML: (el: Element) => (el as HTMLElement).style.fontFamily || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.fontFamily ? { style: `font-family: ${attrs.fontFamily}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontFamily:
        (family: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontFamily: family }).run(),
      unsetFontFamily:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run(),
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
