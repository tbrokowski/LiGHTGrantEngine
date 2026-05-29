'use client';
import { useState, useEffect, useRef } from 'react';
import { User, ChevronDown, Check, Search } from 'lucide-react';
import { api } from '@/lib/api';

interface TeamMember {
  id: string;
  name: string;
  email: string;
}

interface OwnerSelectProps {
  ownerId: string | null | undefined;
  ownerName?: string | null;
  onChange: (userId: string | null, userName: string | null) => void;
  size?: 'sm' | 'md';
}

function UserAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-teal-500', 'bg-orange-500', 'bg-rose-500'];
  const color = colors[(name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % colors.length];
  const cls = size === 'md' ? 'w-6 h-6 text-xs' : 'w-5 h-5 text-[10px]';
  return (
    <div className={`${cls} ${color} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}>
      {initials}
    </div>
  );
}

export { UserAvatar };

export default function OwnerSelect({ ownerId, ownerName, onChange, size = 'sm' }: OwnerSelectProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && members.length === 0) {
      api.get('/users/').then(r => setMembers(r.data || [])).catch(() => {});
    }
  }, [open, members.length]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = members.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 px-2 py-1 transition-colors"
      >
        {ownerName ? (
          <UserAvatar name={ownerName} size={size} />
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center">
            <User className="w-2.5 h-2.5 text-gray-400" />
          </div>
        )}
        <span className="max-w-[100px] truncate">{ownerName || 'Assign'}</span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 w-56 py-1.5">
          <div className="px-2 pb-1.5">
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1">
              <Search className="w-3 h-3 text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search team…"
                className="text-xs outline-none flex-1 placeholder-gray-400"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto">
            {/* Unassign option */}
            {ownerId && (
              <button
                onClick={() => { onChange(null, null); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
              >
                <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300" />
                Unassign
              </button>
            )}
            {filtered.map(m => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id, m.name); setOpen(false); setSearch(''); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-gray-50 text-left"
              >
                <UserAvatar name={m.name} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">{m.name}</div>
                  <div className="text-gray-400 truncate">{m.email}</div>
                </div>
                {m.id === ownerId && <Check className="w-3 h-3 text-blue-600 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-3">No team members found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
