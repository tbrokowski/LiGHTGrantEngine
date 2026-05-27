'use client';
import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { clearAuthSession } from '@/lib/auth-cookie';

export default function TopBar() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function signOut() {
    clearAuthSession();
    window.location.href = '/login';
  }

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6 shrink-0">
      <div />
      {user && (
        <div className="flex items-center gap-4">
          <div ref={ref} className="relative">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 focus:outline-none py-1 px-2 rounded-md hover:bg-gray-50"
          >
            <span className="font-medium">{user.name}</span>
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {open && (
            <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="text-xs text-gray-500 truncate">{user.email}</div>
                {user.institution_id && (
                  <div className="text-xs text-indigo-600 mt-0.5 capitalize">
                    {user.institution_role === 'admin' ? 'Institution Admin' : 'Institution Member'}
                  </div>
                )}
              </div>
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Sign out
              </button>
            </div>
          )}
          </div>
        </div>
      )}
    </header>
  );
}
