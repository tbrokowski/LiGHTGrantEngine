'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, X, Calendar, ExternalLink } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface EntityResult {
  id: string;
  type: 'opportunity' | 'grant';
  title: string;
  funder?: string;
  status?: string;
  deadline?: string;
}

interface EntitySearchModalProps {
  onSelect: (entity: EntityResult) => void;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-50 text-green-700',
  active: 'bg-blue-50 text-blue-700',
  closed: 'bg-gray-100 text-gray-500',
  draft: 'bg-amber-50 text-amber-700',
  submitted: 'bg-indigo-50 text-indigo-700',
};

function formatDeadline(d?: string) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

export default function EntitySearchModal({ onSelect, onClose }: EntitySearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await partnersApi.entitySearch(query);
        setResults(res.data || []);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search grants and opportunities by title…"
            className="flex-1 text-sm outline-none placeholder-gray-400"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && searched && !loading && (
            <div className="text-sm text-gray-400 text-center py-8">No grants or opportunities found.</div>
          )}
          {results.length === 0 && !searched && !loading && (
            <div className="text-xs text-gray-400 text-center py-6">
              Type to search active grants and open opportunities
            </div>
          )}
          {results.map(r => {
            const statusColor = STATUS_COLORS[r.status?.toLowerCase() || ''] || 'bg-gray-100 text-gray-500';
            return (
              <button
                key={r.id}
                onClick={() => { onSelect(r); onClose(); }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
                      r.type === 'grant' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {r.type}
                    </span>
                    {r.status && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor}`}>
                        {r.status}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-900 mt-1 leading-tight">{r.title}</p>
                  {r.funder && (
                    <p className="text-xs text-gray-400 mt-0.5">{r.funder}</p>
                  )}
                  {r.deadline && (
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />Deadline: {formatDeadline(r.deadline)}
                    </p>
                  )}
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-gray-300 mt-1 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
