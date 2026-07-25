'use client';
import { useState, useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { Baseline, Highlighter } from 'lucide-react';
import { FONT_FAMILIES, FONT_SIZES, TEXT_COLORS, HIGHLIGHT_COLORS } from './editor-extensions';

/** Close a popover when clicking outside of it. */
function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);
  return ref;
}

const selectClass =
  'text-xs h-7 rounded border border-gray-200 bg-white text-gray-600 px-1 focus:outline-none focus:border-blue-400 cursor-pointer';

export function FontFamilySelect({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes('textStyle').fontFamily as string) || '';
  return (
    <select
      title="Font"
      value={current}
      onChange={e => {
        const v = e.target.value;
        if (v) editor.chain().focus().setFontFamily(v).run();
        else editor.chain().focus().unsetFontFamily().run();
      }}
      className={`${selectClass} w-24`}
    >
      {FONT_FAMILIES.map(f => (
        <option key={f.label} value={f.value}>{f.label}</option>
      ))}
    </select>
  );
}

export function FontSizeSelect({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes('textStyle').fontSize as string) || '';
  return (
    <select
      title="Font size"
      value={current}
      onChange={e => {
        const v = e.target.value;
        if (v) editor.chain().focus().setFontSize(v).run();
        else editor.chain().focus().unsetFontSize().run();
      }}
      className={`${selectClass} w-14`}
    >
      <option value="">Size</option>
      {FONT_SIZES.map(s => (
        <option key={s} value={s}>{s.replace('pt', '')}</option>
      ))}
    </select>
  );
}

function Swatches({ colors, onPick, onClear, clearLabel }: {
  colors: string[]; onPick: (c: string) => void; onClear: () => void; clearLabel: string;
}) {
  return (
    <div className="grid grid-cols-6 gap-1 w-max">
      {colors.map(c => (
        <button
          key={c}
          type="button"
          onMouseDown={e => { e.preventDefault(); onPick(c); }}
          title={c}
          className="w-5 h-5 rounded border border-gray-200 hover:scale-110 transition-transform"
          style={{ background: c }}
        />
      ))}
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); onClear(); }}
        className="col-span-6 mt-1 text-[10px] text-gray-500 hover:text-gray-800 text-left"
      >
        {clearLabel}
      </button>
    </div>
  );
}

export function ColorButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const current = (editor.getAttributes('textStyle').color as string) || '#000000';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
        title="Text color"
        className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 flex flex-col items-center"
      >
        <Baseline className="w-3.5 h-3.5" />
        <span className="block w-3.5 h-0.5 rounded-sm" style={{ background: current }} />
      </button>
      {open && (
        <div className="absolute z-50 top-9 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <Swatches
            colors={TEXT_COLORS}
            onPick={c => { editor.chain().focus().setColor(c).run(); setOpen(false); }}
            onClear={() => { editor.chain().focus().unsetColor().run(); setOpen(false); }}
            clearLabel="Automatic"
          />
        </div>
      )}
    </div>
  );
}

export function HighlightButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
        title="Highlight color"
        className={`p-1.5 rounded flex items-center ${editor.isActive('highlight') ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
      >
        <Highlighter className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute z-50 top-9 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <Swatches
            colors={HIGHLIGHT_COLORS}
            onPick={c => { editor.chain().focus().toggleHighlight({ color: c }).run(); setOpen(false); }}
            onClear={() => { editor.chain().focus().unsetHighlight().run(); setOpen(false); }}
            clearLabel="No highlight"
          />
        </div>
      )}
    </div>
  );
}
