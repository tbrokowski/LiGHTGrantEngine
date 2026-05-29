'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/finance', label: 'Portfolio', match: (p: string) => p === '/finance' },
  { href: '/finance/requests', label: 'Fund requests', match: (p: string) => p === '/finance/requests' },
];

export default function FinanceNav() {
  const path = usePathname();
  const onGrantDetail = path.startsWith('/finance/') && path !== '/finance/requests';

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-1">
        {TABS.map(tab => {
          const active = tab.match(path);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                active && !onGrantDetail
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
