'use client';
import { useState, useRef, useEffect } from 'react';
import FunderLogo from './FunderLogo';

interface FunderOption {
  name: string;
  logo_url: string | null;
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  options: FunderOption[];
  placeholder?: string;
}

export default function FunderDropdown({ value, onChange, options, placeholder = 'All funders' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase())).slice(0, 40)
    : options.slice(0, 40);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function select(name: string) {
    onChange(name);
    setOpen(false);
    setQuery('');
  }

  function handleOpen() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const displayValue = value || placeholder;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-left bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 hover:border-gray-300"
      >
        {value && (
          <FunderLogo
            name={value}
            url={options.find(o => o.name === value)?.logo_url ?? null}
          />
        )}
        <span className={`flex-1 truncate ${value ? 'text-gray-800' : 'text-gray-400'}`}>
          {displayValue}
        </span>
        {value && (
          <button
            onClick={e => { e.stopPropagation(); select(''); }}
            className="text-gray-300 hover:text-gray-500 text-xs px-0.5"
            aria-label="Clear"
          >
            ✕
          </button>
        )}
        <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div className="p-1.5 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search funders…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div className="overflow-y-auto">
            <button
              onClick={() => select('')}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50"
            >
              All funders
            </button>
            {filtered.map(opt => (
              <button
                key={opt.name}
                onClick={() => select(opt.name)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  opt.name === value ? 'bg-gray-50 font-medium' : ''
                }`}
              >
                <FunderLogo name={opt.name} url={opt.logo_url} />
                <span className="truncate">{opt.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">No funders match</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
