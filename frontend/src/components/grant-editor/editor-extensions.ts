import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

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
  /** Text of the selection a new comment would anchor to ('' if none). */
  getSelectionAnchor: () => string;
  /** Forget that selection (the user dismissed it in the comments panel). */
  clearSelectionAnchor: () => void;
  /** Mark the pending selection with this comment id. Returns false if there was none. */
  applyCommentMark: (id: string) => boolean;
  /** Remove the comment mark carrying this id (other comments' marks are kept). */
  removeCommentMark: (id: string) => void;
  /** Scroll the page to this comment's highlight and flash it; marks `anchorText`
   *  first if the highlight is missing. Returns false if it can't be found. */
  focusComment: (id: string, anchorText?: string | null) => boolean;
  /** Find `anchorText` in the doc and mark it with this id. Returns true if found. */
  locateAndMark: (id: string, anchorText: string) => boolean;
}

/** Shared, pane-local bridge between the editor and its comments panel. */
export interface CommentBridge {
  editor?: CommentEditorApi | null;
  focusCard?: (id: string) => void;
  /** A highlight was clicked while the comments panel was closed: focus this card once it loads. */
  pendingFocusId?: string | null;
}

// ── Comment anchors ─────────────────────────────────────────────────────────

/** Doc range [from, to) covered by the comment mark with this id, or null. */
export function findCommentRange(doc: PMNode, id: string): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'comment' && m.attrs.commentId === id)) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  return from < 0 ? null : { from, to };
}

/**
 * Locate a comment's anchor text in the doc. Matches across formatting (bold,
 * links…) and across paragraph breaks — selections are captured with blocks
 * joined by a space, so the doc is searched the same way — and ignores
 * whitespace differences. If the passage was edited since, falls back to the
 * longest matching prefix (at least 3 words).
 */
export function findAnchorRange(doc: PMNode, anchor: string): { from: number; to: number } | null {
  const norm = (anchor || '').replace(/\s+/g, ' ').trim();
  if (!norm) return null;

  // The doc's text, whitespace collapsed, with the doc position of each char
  // (-1 for the space standing in for a block boundary).
  let text = '';
  const pos: number[] = [];
  const push = (ch: string, at: number) => {
    if (ch === ' ' && (text === '' || text.endsWith(' '))) return;
    text += ch;
    pos.push(at);
  };
  doc.descendants((node, nodePos) => {
    if (node.isTextblock) {
      push(' ', -1);
      return true;
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) push(/\s/.test(node.text[i]) ? ' ' : node.text[i], nodePos + i);
    } else if (node.isLeaf) {
      push(' ', -1); // line breaks, images
    }
    return true;
  });

  const search = (q: string) => {
    const i = text.indexOf(q);
    if (i < 0) return null;
    // Trim to real characters at both ends (skip block-boundary spaces).
    let a = i;
    let b = i + q.length - 1;
    while (a <= b && pos[a] < 0) a++;
    while (b >= a && pos[b] < 0) b--;
    return a <= b ? { from: pos[a], to: pos[b] + 1 } : null;
  };
  const exact = search(norm);
  if (exact) return exact;
  const words = norm.split(' ');
  for (let n = words.length - 1; n >= 3; n--) {
    const hit = search(words.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
}

// ── Active comment flash ────────────────────────────────────────────────────
// The focused comment's highlight is drawn as a decoration — mutating the
// editor's DOM directly makes ProseMirror redraw it (and cancels any scroll).
export const activeCommentKey = new PluginKey<string | null>('activeComment');

export const ActiveComment = Extension.create({
  name: 'activeComment',
  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: activeCommentKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(activeCommentKey);
            return meta === undefined ? value : (meta as string | null);
          },
        },
        props: {
          decorations(state) {
            const id = activeCommentKey.getState(state);
            if (!id) return null;
            const range = findCommentRange(state.doc, id);
            if (!range) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'comment-highlight--active' }),
            ]);
          },
        },
      }),
    ];
  },
});


// ── List indent (Tab / Shift+Tab) ───────────────────────────────────────────
// StarterKit's list item already binds Tab → sink and Shift+Tab → lift, but when
// the command can't run (e.g. Tab on the first item of a list) the key falls
// through and the browser moves focus out of the editor. Inside a list we always
// swallow the key so Tab only ever changes the indent level. Markers per level
// (• ◦ ▪ / 1. a. i.) come from CSS in globals.css; nesting is plain <ul>/<ol>
// markup, so it survives save/load and the PDF/DOCX/Google Docs exports.
export const ListIndent = Extension.create({
  name: 'listIndent',
  // Run before the list item's own Tab bindings so we decide the fallthrough.
  priority: 1000,
  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive('listItem');
    return {
      Tab: () => {
        if (!inList()) return false;
        this.editor.commands.sinkListItem('listItem');
        return true;
      },
      'Shift-Tab': () => {
        if (!inList()) return false;
        this.editor.commands.liftListItem('listItem');
        return true;
      },
    };
  },
});

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
