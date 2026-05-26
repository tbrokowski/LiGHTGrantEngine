'use client';
import { useState, useRef, useEffect } from 'react';
import { grants } from '@/lib/api';

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-500 border-gray-200' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-gray-100 text-gray-500 border-gray-200',
};

interface PriorityTagProps {
  grantId: string;
  priority: string | null;
  onUpdate?: (priority: string | null) => void;
  readOnly?: boolean;
}

export default function PriorityTag({ grantId, priority, onUpdate, readOnly }: PriorityTagProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  async function handleSelect(value: string | null) {
    if (readOnly) return;
    setOpen(false);
    setSaving(true);
    try {
      await grants.update(grantId, { priority: value });
      onUpdate?.(value);
    } catch {
      // silently fail; parent can handle
    } finally {
      setSaving(false);
    }
  }

  const colorClass = priority ? (PRIORITY_COLORS[priority] ?? 'bg-gray-100 text-gray-500 border-gray-200') : 'border-dashed border-gray-200 text-gray-400';
  const label = priority ? PRIORITIES.find(p => p.value === priority)?.label ?? priority : 'Priority';

  if (readOnly) {
    return priority ? (
      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${colorClass}`}>
        {label}
      </span>
    ) : null;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 ${colorClass} ${saving ? 'opacity-50' : ''}`}
      >
        {saving ? '…' : label}
        {!saving && (
          <svg className="w-2.5 h-2.5 ml-1 opacity-60" viewBox="0 0 10 6" fill="currentColor">
            <path d="M0 0l5 6 5-6H0z" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20 min-w-[110px]">
          {PRIORITIES.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleSelect(p.value)}
              className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 transition-colors ${
                priority === p.value ? 'text-gray-900' : 'text-gray-600'
              }`}
            >
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${p.color.split(' ')[0]}`} />
              {p.label}
            </button>
          ))}
          {priority && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
