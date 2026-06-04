'use client';
import Link from 'next/link';
import { useRef, useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth, hasModulePermission, ModulePermissions } from '@/lib/auth';
import { clearAuthSession } from '@/lib/auth-cookie';
import { opportunities } from '@/lib/api';
import { onOpportunitiesChanged } from '@/lib/opportunities-events';

interface NavItem {
  href: string;
  label: string;
  permissionKey?: keyof ModulePermissions;
}

const NAV: NavItem[] = [
  { href: '/dashboard',     label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/grants',        label: 'Grants',   permissionKey: 'can_view_grants' },
  { href: '/finance',       label: 'Finance',  permissionKey: 'can_view_finance' },
  { href: '/archive',       label: 'Archive',  permissionKey: 'can_view_archive' },
  { href: '/partners',      label: 'Partners', permissionKey: 'can_view_partners' },
];

export default function TopBar() {
  const { user } = useAuth();
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    opportunities.newOpportunitiesCounts()
      .then(r => setQueueCount(r.data?.unread ?? null))
      .catch(() => null);
  }, []);

  useEffect(() => { refreshCount(); }, [refreshCount, path]);
  useEffect(() => onOpportunitiesChanged(refreshCount), [refreshCount]);

  /* Close dropdown when clicking outside */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function signOut() {
    clearAuthSession();
    window.location.href = '/login';
  }

  const visibleNav = NAV.filter(item =>
    !item.permissionKey || hasModulePermission(user, item.permissionKey)
  );

  return (
    <header
      style={{
        height: '48px',
        borderBottom: '1px solid var(--rule-subtle)',
        background: 'var(--surface-base)',
      }}
      className="flex items-stretch justify-between px-2 shrink-0"
    >
      {/* Navigation links */}
      <nav className="flex items-stretch gap-0.5">
        {visibleNav.map(({ href, label }) => {
          const active = path === href || path.startsWith(href + '/');
          const isOpportunities = href === '/opportunities';

          return (
            <Link
              key={href}
              href={href}
              className="relative flex items-center gap-1.5 px-3.5 py-1 transition-colors duration-100"
              style={{
                fontSize: '13px',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent-primary)' : 'var(--ink-muted)',
                borderBottom: active
                  ? '2px solid var(--accent-primary)'
                  : '2px solid transparent',
                marginBottom: '-1px',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--ink-primary)';
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--ink-muted)';
              }}
            >
              {label}

              {/* Unread badge for Opportunities */}
              {isOpportunities && queueCount != null && queueCount > 0 && (
                <span
                  style={{
                    background: active ? 'var(--accent-primary)' : 'var(--ink-faint)',
                    color: 'var(--ink-inverse)',
                    fontSize: '9px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0',
                    lineHeight: 1,
                    padding: '2px 5px',
                    borderRadius: '10px',
                    minWidth: '18px',
                    textAlign: 'center',
                  }}
                >
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Right side — sign out via subtle chevron menu */}
      {user && (
        <div ref={menuRef} className="flex items-center pr-2">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-1 px-2 py-1 rounded transition-colors duration-100"
            style={{ color: 'var(--ink-faint)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1v1M8 14v1M1 8h1M14 8h1M3.22 3.22l.7.7M12.08 12.08l.7.7M3.22 12.78l.7-.7M12.08 3.92l.7-.7" />
            </svg>
          </button>

          {menuOpen && (
            <div
              className="absolute right-3 mt-1 w-48 z-50 py-1"
              style={{
                top: '44px',
                border: '1px solid var(--rule-subtle)',
                background: 'var(--surface-panel)',
                boxShadow: 'var(--shadow-floating)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                className="px-3 py-2"
                style={{ borderBottom: '1px solid var(--rule-subtle)' }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                  {user.name}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--ink-muted)', marginTop: '1px' }} className="truncate">
                  {user.email}
                </div>
                {user.institution_id && (
                  <div style={{ fontSize: '10px', color: 'var(--accent-primary)', marginTop: '2px' }}>
                    {user.institution_role === 'admin' ? 'Institution Admin' : 'Institution Member'}
                  </div>
                )}
              </div>
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--ink-secondary)', fontSize: '13px' }}
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
