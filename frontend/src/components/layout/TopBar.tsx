'use client';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth, hasModulePermission, ModulePermissions } from '@/lib/auth';
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
  const [queueCount, setQueueCount] = useState<number | null>(null);

  const refreshCount = useCallback(() => {
    opportunities.newOpportunitiesCounts()
      .then(r => setQueueCount(r.data?.unread ?? null))
      .catch(() => null);
  }, []);

  useEffect(() => { refreshCount(); }, [refreshCount, path]);
  useEffect(() => onOpportunitiesChanged(refreshCount), [refreshCount]);

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

    </header>
  );
}
