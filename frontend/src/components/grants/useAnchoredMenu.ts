'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const GAP = 4;
const EDGE = 8;
const MIN_HEIGHT = 120;

interface Options {
  /** Which edge of the menu lines up with the trigger. */
  align?: 'left' | 'right';
}

/**
 * Drives a dropdown that renders in a portal on <body> with fixed positioning.
 *
 * The cards in this tab are `overflow-hidden` (for their rounded corners and
 * left accent rail), which clips any absolutely-positioned descendant — so an
 * in-tree menu gets cut off at the card's edge no matter its z-index. Anchoring
 * a portaled, fixed-position menu to the trigger's measured rect sidesteps that
 * and every other clipping/stacking ancestor.
 *
 * Also flips the menu above the trigger when there isn't room below, clamps it
 * to the viewport, and closes on outside click / Escape.
 */
export function useAnchoredMenu({ align = 'right' }: Options = {}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Portals need a DOM target, which doesn't exist during SSR.
  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    // Trigger scrolled out of view — nothing sensible to anchor to.
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }

    const { offsetHeight: height, offsetWidth: width } = menu;
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const flip = height > below && above > below;

    setPos({
      top: flip ? Math.max(EDGE, rect.top - GAP - Math.min(height, above)) : rect.bottom + GAP,
      left: Math.min(
        Math.max(EDGE, align === 'right' ? rect.right - width : rect.left),
        Math.max(EDGE, window.innerWidth - width - EDGE),
      ),
      maxHeight: Math.max(MIN_HEIGHT, flip ? above : below),
    });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // A fixed-position menu doesn't move with its trigger, so re-anchor it
    // whenever anything scrolls or the viewport changes.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, close, place]);

  /** Spread onto the portaled menu element. */
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: pos?.top ?? -9999,
    left: pos?.left ?? -9999,
    maxHeight: pos?.maxHeight,
    // Hidden for the one frame between mount and measurement.
    visibility: pos ? 'visible' : 'hidden',
    zIndex: 60,
    overflowY: 'auto',
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-panel)',
    boxShadow: 'var(--shadow-floating)',
  };

  return { open, setOpen, close, mounted, triggerRef, menuRef, menuStyle };
}
