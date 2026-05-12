'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const nav = [
  { href: '/dashboard',     label: 'Dashboard',    icon: '📊' },
  { href: '/opportunities', label: 'Opportunities', icon: '🔍' },
  { href: '/grants',        label: 'Active Grants', icon: '💼' },
  { href: '/archive',       label: 'Archive',       icon: '📚' },
  { href: '/partners',      label: 'Partners',      icon: '🤝' },
  { href: '/settings',      label: 'Settings',      icon: '⚙️' },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      <div className="p-5 border-b border-gray-100">
        <div className="font-bold text-blue-700 text-lg">LiGHT Grants</div>
        <div className="text-xs text-gray-400">Grant Intelligence Hub</div>
      </div>
      <nav className="flex-1 p-3">
        {nav.map(item => (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors
              ${path.startsWith(item.href) ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-100 text-xs text-gray-400">
        AI: Qwen on cluster
      </div>
    </aside>
  );
}
