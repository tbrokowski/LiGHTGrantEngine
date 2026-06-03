'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useCallback, useState } from 'react';
import { opportunities } from '@/lib/api';
import { onOpportunitiesChanged } from '@/lib/opportunities-events';
import { useAuth, hasModulePermission, ModulePermissions } from '@/lib/auth';

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

export default function Sidebar() {
  const path = usePathname();
  const { user } = useAuth();
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
    <aside
      style={{ width: 'var(--space-rail)', borderRight: '1px solid var(--rule-subtle)' }}
      className="shrink-0 flex flex-col h-full bg-[var(--surface-raised)]"
    >
      {/* Logo */}
      <div
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
        className="px-5 pt-5 pb-4"
      >
        <Link href="/dashboard" className="block">
          <Image src="/logo.png" alt="LiGHT" width={80} height={21} className="object-contain" priority />
          <p className="ledger-label mt-2 pl-0.5">Grant Engine</p>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-px overflow-y-auto">
        {/* Section marker */}
        <p className="ledger-label px-2.5 pb-2">Navigation</p>

        {visibleNav.map(({ href, label }) => {
          const active = path === href || path.startsWith(href + '/');
          const isOpportunities = href === '/opportunities';

          return (
            <Link
              key={href}
              href={href}
              className={`
                relative flex items-center justify-between px-2.5 py-1.5 text-sm
                rounded-[var(--radius-sm)] transition-colors duration-100
                ${active
                  ? 'font-medium text-[var(--accent-primary)] bg-[var(--accent-secondary)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[var(--surface-sunken)]'
                }
              `}
            >
              {/* Left accent bar */}
              {active && (
                <span
                  className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full"
                  style={{ background: 'var(--accent-primary)' }}
                />
              )}

              <span className="pl-1">{label}</span>

              {/* Unread count badge */}
              {isOpportunities && queueCount != null && queueCount > 0 && (
                <span
                  style={{
                    background: active ? 'var(--accent-primary)' : 'var(--ink-faint)',
                    color: 'var(--ink-inverse)',
                  }}
                  className="mono-data text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] leading-none min-w-[1.25rem] text-center"
                >
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Settings — separated at bottom */}
      <div style={{ borderTop: '1px solid var(--rule-subtle)' }} className="px-3 py-3">
        <Link
          href="/settings"
          className={`
            flex items-center px-2.5 py-1.5 text-sm rounded-[var(--radius-sm)] transition-colors duration-100
            ${path.startsWith('/settings')
              ? 'font-medium text-[var(--accent-primary)] bg-[var(--accent-secondary)]'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[var(--surface-sunken)]'
            }
          `}
        >
          {path.startsWith('/settings') && (
            <span
              className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full"
              style={{ background: 'var(--accent-primary)' }}
            />
          )}
          <span className="pl-1">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
