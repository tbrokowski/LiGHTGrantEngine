'use client';
import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { clearAuthSession } from '@/lib/auth-cookie';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':     'Dashboard',
  '/opportunities': 'Opportunities',
  '/grants':        'Grants',
  '/finance':       'Finance',
  '/archive':       'Archive',
  '/partners':      'Partners',
  '/settings':      'Settings',
};

function getPageTitle(path: string): string {
  if (PAGE_TITLES[path]) return PAGE_TITLES[path];
  for (const [prefix, label] of Object.entries(PAGE_TITLES)) {
    if (path.startsWith(prefix + '/')) return label;
  }
  return '';
}

export default function TopBar() {
  const { user } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pageTitle = getPageTitle(path);

  function signOut() {
    clearAuthSession();
    window.location.href = '/login';
  }

  return (
    <header
      style={{
        height: '44px',
        borderBottom: '1px solid var(--rule-subtle)',
        background: 'var(--surface-base)',
      }}
      className="flex items-center justify-between px-6 shrink-0"
    >
      {/* Page title — left side now does real work */}
      <div className="flex items-center gap-3">
        {pageTitle && (
          <span className="ledger-label" style={{ color: 'var(--ink-muted)' }}>
            {pageTitle}
          </span>
        )}
      </div>

      {/* User section */}
      {user && (
        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 text-sm transition-colors py-1 px-2 rounded-[var(--radius-sm)]"
            style={{ color: 'var(--ink-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
          >
            <span className="font-medium" style={{ color: 'var(--ink-secondary)', fontSize: '13px' }}>
              {user.name}
            </span>
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--ink-faint)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {open && (
            <div
              style={{
                border: '1px solid var(--rule-subtle)',
                background: 'var(--surface-panel)',
                boxShadow: 'var(--shadow-floating)',
                borderRadius: 'var(--radius-md)',
              }}
              className="absolute right-0 mt-1 w-52 z-50 py-1"
            >
              <div
                style={{ borderBottom: '1px solid var(--rule-subtle)' }}
                className="px-3 py-2"
              >
                <div className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                  {user.email}
                </div>
                {user.institution_id && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--accent-primary)' }}>
                    {user.institution_role === 'admin' ? 'Institution Admin' : 'Institution Member'}
                  </div>
                )}
              </div>
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--ink-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
