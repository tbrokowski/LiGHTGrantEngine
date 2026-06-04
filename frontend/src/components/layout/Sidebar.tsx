'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Sidebar() {
  const path = usePathname();
  const { user } = useAuth();

  const isSettings = path.startsWith('/settings');

  return (
    <aside
      style={{
        width: 'var(--space-rail)',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid rgba(0,0,0,0.18)',
      }}
      className="shrink-0 flex flex-col h-full"
    >
      {/* Logo block */}
      <div
        className="px-5 pt-6 pb-5"
        style={{ borderBottom: '1px solid var(--sidebar-rule)' }}
      >
        <Link href="/dashboard" className="block">
          <Image
            src="/logo.png"
            alt="LiGHT"
            width={72}
            height={19}
            className="object-contain brightness-0 invert"
            priority
          />
          <p
            className="mt-2 pl-0.5"
            style={{
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--sidebar-fg-muted)',
            }}
          >
            Grant Engine
          </p>
        </Link>
      </div>

      {/* Spacer — identity/brand area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Subtle watermark */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
          aria-hidden
        >
          <span
            style={{
              fontSize: '80px',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: 'rgba(255,255,255,0.025)',
              userSelect: 'none',
            }}
          >
            L
          </span>
        </div>

        {/* Decorative gradient glow at bottom of brand area */}
        <div
          className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
          style={{
            background: 'linear-gradient(to top, rgba(28,60,114,0.3), transparent)',
          }}
          aria-hidden
        />
      </div>

      {/* User name */}
      {user && (
        <div
          className="px-4 py-3"
          style={{ borderTop: '1px solid var(--sidebar-rule)' }}
        >
          <p
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--sidebar-fg)',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {user.name}
          </p>
          {user.email && (
            <p
              style={{
                fontSize: '10px',
                color: 'var(--sidebar-fg-muted)',
                marginTop: '1px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {user.email}
            </p>
          )}
        </div>
      )}

      {/* Settings */}
      <div className="px-3 pb-4">
        <Link
          href="/settings"
          className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] transition-colors duration-150"
          style={{
            color: isSettings ? 'var(--sidebar-fg-active)' : 'var(--sidebar-fg)',
            background: isSettings ? 'var(--sidebar-accent)' : 'transparent',
            fontSize: '13px',
            fontWeight: isSettings ? 600 : 400,
          }}
          onMouseEnter={e => {
            if (!isSettings) (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.07)';
          }}
          onMouseLeave={e => {
            if (!isSettings) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
          }}
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
          </svg>
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
