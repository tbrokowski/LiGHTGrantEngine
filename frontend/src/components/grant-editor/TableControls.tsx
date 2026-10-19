'use client';
import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  TableIcon, ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  Rows3, Columns3, TableCellsMerge, TableCellsSplit, PanelTop, Trash2,
} from 'lucide-react';

const GRID_ROWS = 8;
const GRID_COLS = 10;

/** Toolbar button that opens a hover grid to pick the new table's size. */
export function TableInsertButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const insert = (rows: number, cols: number) => {
    setOpen(false);
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setHover({ rows: 0, cols: 0 }); setOpen((o) => !o); }}
        title="Insert table"
        className={`p-1.5 rounded text-xs transition-colors ${open ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
      >
        <TableIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-8 z-50 p-2 rounded-[var(--radius-md)]"
          style={{ background: 'var(--surface-panel)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
          onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
        >
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1rem)` }}>
            {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
              const r = Math.floor(i / GRID_COLS) + 1;
              const c = (i % GRID_COLS) + 1;
              const lit = r <= hover.rows && c <= hover.cols;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`${r} by ${c} table`}
                  onMouseEnter={() => setHover({ rows: r, cols: c })}
                  onMouseDown={(e) => { e.preventDefault(); insert(r, c); }}
                  className="w-4 h-4 rounded-[2px]"
                  style={{
                    border: '1px solid',
                    borderColor: lit ? 'var(--accent-primary)' : 'var(--rule-subtle)',
                    background: lit ? 'var(--accent-secondary)' : 'transparent',
                  }}
                />
              );
            })}
          </div>
          <div className="mt-1.5 text-[11px] text-center tabular-nums" style={{ color: 'var(--ink-muted)' }}>
            {hover.rows ? `${hover.rows} × ${hover.cols} table` : 'Pick a size'}
          </div>
          <CustomSize onInsert={insert} />
        </div>
      )}
    </div>
  );
}

/** Rows × columns inputs for tables bigger than the hover grid. */
function CustomSize({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const clamp = (n: number) => Math.max(1, Math.min(50, Math.floor(n) || 1));
  const inputClass = 'w-10 h-6 px-1 text-xs rounded border text-center tabular-nums focus:outline-none';
  const inputStyle = { borderColor: 'var(--rule-subtle)', background: 'var(--surface-base)', color: 'var(--ink-primary)' };
  return (
    <div className="mt-2 pt-2 flex items-center gap-1 text-xs" style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
      <input type="number" min={1} max={50} value={rows} onChange={(e) => setRows(clamp(+e.target.value))} className={inputClass} style={inputStyle} aria-label="Rows" />
      ×
      <input type="number" min={1} max={50} value={cols} onChange={(e) => setCols(clamp(+e.target.value))} className={inputClass} style={inputStyle} aria-label="Columns" />
      <button
        type="button"
        onClick={() => onInsert(rows, cols)}
        className="ml-auto px-2 h-6 rounded text-xs font-medium hover:bg-[var(--selection-bg)]"
        style={{ color: 'var(--ink-secondary)', border: '1px solid var(--rule-subtle)' }}
      >
        Insert
      </button>
    </div>
  );
}

/** Row/column/cell controls, shown while the cursor is inside a table. */
export function TableContextBar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      inTable: ed.isActive('table'),
      canMerge: ed.can().mergeCells(),
      canSplit: ed.can().splitCell(),
      canDeleteRow: ed.can().deleteRow(),
      canDeleteCol: ed.can().deleteColumn(),
    }),
  });
  if (!state?.inTable) return null;

  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => fn(editor.chain().focus()).run();

  const btn = (title: string, icon: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; danger?: boolean; label?: string } = {}) => (
    <button
      key={title}
      type="button"
      title={title}
      disabled={opts.disabled}
      onMouseDown={(e) => { e.preventDefault(); if (!opts.disabled) onClick(); }}
      className="flex items-center gap-1 p-1.5 rounded text-xs transition-colors hover:bg-[var(--selection-bg)] disabled:opacity-40 disabled:hover:bg-transparent"
      style={{ color: opts.danger ? 'var(--state-danger)' : 'var(--ink-muted)' }}
    >
      {icon}{opts.label}
    </button>
  );
  const sep = (k: string) => <div key={k} className="w-px h-4 mx-0.5" style={{ background: 'var(--rule-subtle)' }} />;
  const i = 'w-3.5 h-3.5';

  return (
    <div className="w-full flex items-center gap-0.5 flex-wrap pt-1 mt-1" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
      <span className="text-[11px] font-medium uppercase tracking-wide mr-1" style={{ color: 'var(--ink-muted)' }}>Table</span>
      {btn('Insert row above', <ArrowUpToLine className={i} />, () => run((c) => c.addRowBefore()))}
      {btn('Insert row below', <ArrowDownToLine className={i} />, () => run((c) => c.addRowAfter()))}
      {btn('Insert column left', <ArrowLeftToLine className={i} />, () => run((c) => c.addColumnBefore()))}
      {btn('Insert column right', <ArrowRightToLine className={i} />, () => run((c) => c.addColumnAfter()))}
      {sep('s1')}
      {btn('Delete row', <Rows3 className={i} />, () => run((c) => c.deleteRow()), { disabled: !state.canDeleteRow, label: '−' })}
      {btn('Delete column', <Columns3 className={i} />, () => run((c) => c.deleteColumn()), { disabled: !state.canDeleteCol, label: '−' })}
      {sep('s2')}
      {btn('Merge cells (select several cells first)', <TableCellsMerge className={i} />, () => run((c) => c.mergeCells()), { disabled: !state.canMerge })}
      {btn('Split cell', <TableCellsSplit className={i} />, () => run((c) => c.splitCell()), { disabled: !state.canSplit })}
      {btn('Toggle header row', <PanelTop className={i} />, () => run((c) => c.toggleHeaderRow()))}
      {sep('s3')}
      {btn('Delete table', <Trash2 className={i} />, () => run((c) => c.deleteTable()), { danger: true })}
    </div>
  );
}
