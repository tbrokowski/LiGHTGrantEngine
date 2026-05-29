'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X } from 'lucide-react';

interface InlineFieldProps {
  value: string | null | undefined;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  displayClass?: string;
  inputClass?: string;
  emptyLabel?: string;
  label?: string;
  multiline?: boolean;
}

export default function InlineField({
  value,
  onSave,
  placeholder = 'Click to edit…',
  type = 'text',
  options = [],
  displayClass = '',
  inputClass = '',
  emptyLabel,
  label,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  // Sync when prop changes externally
  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      // keep editing state open on error
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setDraft(value ?? '');
      setEditing(false);
    }
  }

  const displayValue = value || '';
  const isEmpty = !displayValue;

  const baseInput = 'border border-blue-400 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full';

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        {type === 'textarea' ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            rows={3}
            className={`${baseInput} resize-none ${inputClass}`}
          />
        ) : type === 'select' ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            className={`${baseInput} ${inputClass}`}
          >
            {options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            placeholder={placeholder}
            className={`${baseInput} ${inputClass}`}
          />
        )}
        {saving ? (
          <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
        ) : (
          <div className="flex gap-0.5">
            <button type="button" onClick={handleSave}
              className="p-0.5 text-green-600 hover:bg-green-50 rounded">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => { setDraft(value ?? ''); setEditing(false); }}
              className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1 min-w-0">
      {label && <span className="text-xs text-gray-400 shrink-0">{label}:</span>}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`text-left truncate hover:text-blue-700 transition-colors cursor-text ${
          isEmpty ? 'text-gray-400 italic' : ''
        } ${displayClass} group-hover:underline group-hover:decoration-dashed group-hover:underline-offset-2 group-hover:decoration-gray-400`}
        title="Click to edit"
      >
        {isEmpty ? (emptyLabel || placeholder) : displayValue}
      </button>
    </div>
  );
}
