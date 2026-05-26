'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

const LS_KEY = 'dashboard_scratchpad';
const DEBOUNCE_MS = 800;

export default function Scratchpad() {
  const [text, setText] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoad = useRef(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved !== null) setText(saved);
    } catch {}
    initialLoad.current = false;
  }, []);

  const handleChange = useCallback((val: string) => {
    setText(val);
    if (initialLoad.current) return;
    setSaveState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, val);
        setSaveState('saved');
        timerRef.current = setTimeout(() => setSaveState('idle'), 2000);
      } catch {
        setSaveState('idle');
      }
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3.5 border-b border-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Scratchpad</h2>
          <svg className="w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </div>
        <span className={`text-[10px] font-medium transition-all duration-300 ${
          saveState === 'saved' ? 'text-emerald-500' :
          saveState === 'pending' ? 'text-gray-300' :
          'text-gray-200'
        }`}>
          {saveState === 'saved' ? 'Saved' : saveState === 'pending' ? 'Saving...' : 'Local'}
        </span>
      </div>

      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="Notes, ideas, things to follow up on..."
        className="flex-1 w-full resize-none px-4 py-3 text-sm text-gray-700 placeholder-gray-300 bg-transparent focus:outline-none leading-relaxed"
        spellCheck={false}
      />

      <div className="px-4 py-2 border-t border-gray-50 flex items-center justify-between">
        <span className="text-[10px] text-gray-300 tabular-nums">
          {text.length > 0 ? `${text.length} chars` : ''}
        </span>
        {text.length > 0 && (
          <button
            onClick={() => { handleChange(''); }}
            className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
