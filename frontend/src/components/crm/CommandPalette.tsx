'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users, Plus, Calendar, Compass } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface Partner {
  id: string;
  name: string;
  organization?: string;
  email?: string;
}

interface CommandPaletteProps {
  onClose: () => void;
  onNewPartner?: () => void;
}

type ResultItem =
  | { type: 'partner'; id: string; name: string; subtitle: string }
  | { type: 'action'; id: string; label: string; icon: React.ReactNode; action: () => void };

export default function CommandPalette({ onClose, onNewPartner }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [partnerResults, setPartnerResults] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setPartnerResults([]); return; }
    setLoading(true);
    try {
      const res = await partnersApi.list({ q, limit: 6 });
      setPartnerResults(res.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  const staticActions: ResultItem[] = [
    {
      type: 'action',
      id: 'new-partner',
      label: 'New partner',
      icon: <Plus className="w-3.5 h-3.5 text-blue-600" />,
      action: () => { onNewPartner?.(); onClose(); },
    },
    {
      type: 'action',
      id: 'find-partners',
      label: 'Discover new partners with AI',
      icon: <Compass className="w-3.5 h-3.5 text-purple-600" />,
      action: () => { router.push('/partners/find'); onClose(); },
    },
    {
      type: 'action',
      id: 'all-partners',
      label: 'View all partners',
      icon: <Users className="w-3.5 h-3.5 text-gray-500" />,
      action: () => { router.push('/partners'); onClose(); },
    },
    {
      type: 'action',
      id: 'calendar',
      label: 'Open partner calendar',
      icon: <Calendar className="w-3.5 h-3.5 text-green-600" />,
      action: () => { router.push('/partners?view=calendar'); onClose(); },
    },
  ];

  const partnerItems: ResultItem[] = partnerResults.map(p => ({
    type: 'partner' as const,
    id: p.id,
    name: p.name,
    subtitle: [p.organization, p.email].filter(Boolean).join(' · '),
  }));

  const allItems: ResultItem[] = query.trim() ? [...partnerItems, ...staticActions] : staticActions;

  useEffect(() => { setSelectedIdx(0); }, [allItems.length]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, allItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = allItems[selectedIdx];
      if (!item) return;
      if (item.type === 'partner') { router.push(`/partners/${item.id}`); onClose(); }
      else if (item.type === 'action') item.action();
    }
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search partners, or type an action…"
            className="flex-1 text-sm outline-none text-gray-900 placeholder-gray-400"
          />
          {loading && <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin shrink-0" />}
          <kbd className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">ESC</kbd>
        </div>

        {/* Results */}
        <div className="py-1.5 max-h-80 overflow-y-auto">
          {allItems.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-6">No partners found</div>
          )}
          {allItems.map((item, idx) => (
            <button
              key={item.id}
              onMouseEnter={() => setSelectedIdx(idx)}
              onClick={() => {
                if (item.type === 'partner') { router.push(`/partners/${item.id}`); onClose(); }
                else item.action();
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                idx === selectedIdx ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              {item.type === 'partner' ? (
                <>
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-xs font-semibold text-blue-600 shrink-0">
                    {item.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    {item.subtitle && <p className="text-xs text-gray-400 truncate">{item.subtitle}</p>}
                  </div>
                  <span className="text-xs text-gray-300">Partner</span>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <p className="text-sm text-gray-700 flex-1">{item.label}</p>
                </>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-400">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
        </div>
      </div>
    </div>
  );
}
