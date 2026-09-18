'use client';
import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from './useAnchoredMenu';

const itemClass = 'block w-full text-left px-3 py-2 text-sm transition-colors';
const itemStyle = { color: 'var(--ink-secondary)' } as const;
const hoverOn = (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.background = 'var(--surface-sunken)');
const hoverOff = (e: { currentTarget: HTMLElement }) => (e.currentTarget.style.background = 'transparent');

export function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={itemClass}
      style={itemStyle}
      onMouseEnter={hoverOn}
      onMouseLeave={hoverOff}
    >
      {children}
    </button>
  );
}

export function MenuLink({ href, onClick, children }: { href: string; onClick?: () => void; children: ReactNode }) {
  return (
    <a
      href={href}
      role="menuitem"
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={itemClass}
      style={itemStyle}
      onMouseEnter={hoverOn}
      onMouseLeave={hoverOff}
    >
      {children}
    </a>
  );
}

export function MenuDivider() {
  return <div style={{ borderTop: '1px solid var(--rule-subtle)', margin: '4px 0' }} />;
}

interface Props {
  /** Receives a `close` callback so items can dismiss the menu when picked. */
  children: (close: () => void) => ReactNode;
  /** Tailwind radius token for the trigger button. */
  triggerRadius?: string;
}

/**
 * Three-dot overflow menu for the grant cards. The dropdown is portaled and
 * fixed-positioned so the card's `overflow-hidden` can't clip it — see
 * {@link useAnchoredMenu}.
 */
export default function CardMenu({ children, triggerRadius = 'var(--radius-xs)' }: Props) {
  const { open, setOpen, close, mounted, triggerRef, menuRef, menuStyle } = useAnchoredMenu({ align: 'right' });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => setOpen(v => !v)}
        className="w-6 h-6 flex items-center justify-center transition-colors"
        style={{ color: 'var(--ink-primary)', borderRadius: triggerRadius }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {mounted && open && createPortal(
        <div ref={menuRef} role="menu" className="w-44 py-1" style={menuStyle}>
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}
