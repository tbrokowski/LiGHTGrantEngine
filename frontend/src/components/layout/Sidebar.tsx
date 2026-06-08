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
          {/* Wave layer A — primary, 3 peaks baked into a 300%-wide gradient.
              background-position scrolls the peaks left→right at 11s/cycle. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: [
                'linear-gradient(90deg,',
                '  transparent        0%,',
                '  rgba(255,255,255,0.012)  8%,',
                '  rgba(255,255,255,0.062) 14%,',
                '  rgba(255,255,255,0.012) 20%,',
                '  transparent       30%,',
                '  rgba(255,255,255,0.009) 43%,',
                '  rgba(255,255,255,0.050) 49%,',
                '  rgba(255,255,255,0.009) 55%,',
                '  transparent       65%,',
                '  rgba(255,255,255,0.006) 78%,',
                '  rgba(255,255,255,0.036) 84%,',
                '  transparent      100%)',
              ].join(''),
              backgroundSize: '300% 100%',
              animation: 'lh-wave 11s linear infinite',
            }}
          />
          {/* Wave layer B — slightly narrower peaks, faster, phase-offset.
              Constructive interference at crossings creates convincing swell. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: [
                'linear-gradient(90deg,',
                '  transparent        0%,',
                '  rgba(255,255,255,0.010) 11%,',
                '  rgba(255,255,255,0.048) 17%,',
                '  rgba(255,255,255,0.010) 23%,',
                '  transparent       36%,',
                '  rgba(255,255,255,0.007) 51%,',
                '  rgba(255,255,255,0.040) 58%,',
                '  rgba(255,255,255,0.007) 65%,',
                '  transparent       80%,',
                '  transparent      100%)',
              ].join(''),
              backgroundSize: '250% 100%',
              animation: 'lh-wave 7.5s linear infinite',
              animationDelay: '-3.8s',
            }}
          />

          {/* Lighthouse + beam assembly
              width: 100% of sidebar; aspect-ratio 2/3 sets height to 150% of width.
              Vertically centered so the tower fills the nav area. */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '100%',
              aspectRatio: '2 / 3',
            }}
          >
            {/* Fan beam — behind image, pivots at lantern (left-center of element) */}
            <div
              style={{
                position: 'absolute',
                top: '7%',
                left: '50%',
                width: '240%',
                height: '45%',
                transformOrigin: '0 50%',
                clipPath: 'polygon(0 28%, 0 72%, 100% 100%, 100% 0%)',
                background: 'linear-gradient(to right, rgba(255,255,255,0.16), transparent 85%)',
                animation: 'lh-beam 6s ease-in-out infinite',
              }}
            />

            {/* Lighthouse silhouette — in front of beam, behind ray */}
            <Image
              src="/lighthouse.png"
              alt=""
              fill
              style={{
                opacity: 0.10,
                objectFit: 'contain',
                objectPosition: 'center',
                filter: 'brightness(0) invert(1)',
              }}
            />

            {/* Thin ray — same apex as fan, rotates downward to complement
                the upper-right beam (≈95° apart, creating a diverging pair). */}
            <div
              style={{
                position: 'absolute',
                top: '8%',
                left: '50%',
                width: '180%',
                height: '1px',
                transformOrigin: '0 0',
                transform: 'rotate(70deg)',
                background: 'linear-gradient(to right, rgba(255,255,255,0.60), transparent 75%)',
                animation: 'lh-ray 6s ease-in-out infinite',
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
