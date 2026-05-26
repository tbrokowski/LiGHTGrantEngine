'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { opportunities } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/grants', label: 'Grants' },
  { href: '/archive', label: 'Archive' },
  { href: '/partners', label: 'Partners' },
  { href: '/settings', label: 'Settings' },
];

export default function Sidebar() {
  const path = usePathname();
  const [queueCount, setQueueCount] = useState<number | null>(null);

  useEffect(() => {
    opportunities.queueCounts()
      .then(r => setQueueCount(r.data?.unread ?? null))
      .catch(() => null);
  }, []);

  return (
    <aside className="w-52 shrink-0 flex flex-col h-full bg-white border-r border-gray-100">
      <div className="px-5 pt-5 pb-4 border-b border-gray-100">
        <Image src="/logo.png" alt="LiGHT" width={90} height={24} className="object-contain" priority />
        <p className="text-[9px] font-semibold tracking-[0.2em] text-gray-400 uppercase mt-1.5 pl-0.5">
          Grant Engine
        </p>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label }) => {
          const active = path === href || path.startsWith(href + '/');
          const isOpportunities = href === '/opportunities';
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${
                active
                  ? 'font-semibold text-gray-900 bg-gray-50'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {/* Left accent bar for active state */}
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
    </aside>
  );
}
