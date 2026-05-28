'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { opportunities } from '@/lib/api';
import { useAuth, hasModulePermission, ModulePermissions } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  permissionKey?: keyof ModulePermissions;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/grants', label: 'Grants', permissionKey: 'can_view_grants' },
  { href: '/archive', label: 'Archive', permissionKey: 'can_view_archive' },
  { href: '/partners', label: 'Partners', permissionKey: 'can_view_partners' },
  { href: '/settings', label: 'Settings' },
];

export default function Sidebar() {
  const path = usePathname();
  const { user } = useAuth();
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    opportunities.queueCounts()
      .then(r => setQueueCount(r.data?.unread ?? null))
      .catch(() => null);
  }, []);

  const isDashboard = path === '/dashboard';

  const visibleNav = NAV.filter(item => {
    if (!item.permissionKey) return true;
    return hasModulePermission(user, item.permissionKey);
  });

  function handleMouseEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setIsOpen(true);
  }

  function handleMouseLeave() {
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  }

  const logoBlock = (
    <div className="px-5 pt-5 pb-4 border-b border-gray-100">
      <Link href="/dashboard" className="block" onClick={() => setIsOpen(false)}>
        <Image src="/logo.png" alt="LiGHT" width={90} height={24} className="object-contain" priority />
        <p className="text-[9px] font-semibold tracking-[0.2em] text-gray-400 uppercase mt-1.5 pl-0.5">
          Grant Engine
        </p>
      </Link>
    </div>
  );

  const navBlock = (
    <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
      {visibleNav.map(({ href, label }) => {
        const active = path === href || path.startsWith(href + '/');
        const isOpportunities = href === '/opportunities';
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setIsOpen(false)}
            className={`relative flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${
              active
                ? 'font-semibold text-gray-900 bg-gray-50'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 bg-gray-900 rounded-r-full" />
            )}
            <span>{label}</span>
            {isOpportunities && queueCount != null && queueCount > 0 && (
              <span className="ml-auto text-xs font-semibold text-white bg-gray-400 rounded-full px-1.5 py-0.5 leading-none tabular-nums min-w-[1.25rem] text-center">
                {queueCount > 99 ? '99+' : queueCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  if (isDashboard) {
    return (
      <aside className="w-52 shrink-0 flex flex-col h-full bg-white border-r border-gray-100">
        {logoBlock}
        {navBlock}
      </aside>
    );
  }

  return (
    <>
      {/* Zero-width spacer: sidebar takes no space in the flex layout */}
      <div className="w-0 shrink-0" />

      {/* Fixed hover zone covering the left edge */}
      <div
        className="fixed left-0 top-0 h-screen z-50"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Thin always-visible strip */}
        <div className="absolute left-0 top-0 h-full w-3 bg-white border-r border-gray-200" />

        {/* Sidebar panel — slides in on hover */}
        <aside
          className={`absolute left-0 top-0 h-full w-52 flex flex-col bg-white border-r border-gray-100 shadow-xl transition-transform duration-200 ease-in-out ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {logoBlock}
          {navBlock}
        </aside>
      </div>
    </>
  );
}
