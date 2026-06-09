'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useCallback, useState } from 'react';
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

      {/* Nav + brand area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Lighthouse watermark with animations */}
        <div
          className="absolute inset-0 pointer-events-none select-none overflow-hidden"
          aria-hidden
        >
          {/* Lighthouse + beam assembly
              top:58% shifts the center below mid-point so the base sits lower
              in the nav area. width/height unchanged. */}
          <div
            style={{
              position: 'absolute',
              top: '63%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '150%',
              height: '90%',
            }}
          >
            {/* Narrow triangle beam.
                KEY: transformOrigin is '0 50%' so the pivot (apex) sits at
                     top + height/2 in container coords, NOT at top.
                     With height:40%, apex = top + 20%.
                     Lantern is at ~20% of container → top = 20% - 20% = 0%.
                     Using top:-2% puts apex at 18%, just above the glass dome. */}
            <div
              style={{
                position: 'absolute',
                top: '5%',
                left: '53%',
                width: '200%',
                height: '40%',
                transformOrigin: '0 50%',
                clipPath: 'polygon(0 50%, 100% 20%, 100% 80%)',
                background: 'linear-gradient(to right, rgba(255,255,255,0.22) 0%, transparent 85%)',
                animation: 'lh-beam 6s ease-in-out infinite',
              }}
            />

            {/* Lighthouse silhouette — cover fills the tall container,
                objectPosition top keeps the lantern near the top of the frame. */}
            <Image
              src="/lighthouse.png"
              alt=""
              fill
              style={{
                opacity: 0.11,
                objectFit: 'cover',
                objectPosition: 'center top',
                filter: 'brightness(0) invert(1)',
              }}
            />
          </div>
        </div>

        {/* Navigation links */}
        <nav className="relative z-10 px-3 pt-4 pb-2 space-y-px overflow-y-auto">
          {visibleNav.map(({ href, label }) => {
            const active = path === href || path.startsWith(href + '/');
            const isOpportunities = href === '/opportunities';

            return (
              <Link
                key={href}
                href={href}
                className="relative flex items-center justify-between px-2.5 py-1.5 rounded-[var(--radius-sm)] transition-colors duration-100"
                style={{
                  fontSize: '13px',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--sidebar-fg-active)' : 'var(--sidebar-fg)',
                  background: active ? 'var(--sidebar-accent)' : 'transparent',
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.07)';
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                }}
              >
                {/* Left accent bar */}
                {active && (
                  <span
                    className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full"
                    style={{ background: 'rgba(255,255,255,0.6)' }}
                  />
                )}

                <span className="pl-1">{label}</span>

                {/* Unread badge */}
                {isOpportunities && queueCount != null && queueCount > 0 && (
                  <span
                    style={{
                      background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
                      color: 'var(--sidebar-fg-active)',
                      fontSize: '9px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
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

        {/* Decorative gradient glow */}
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
