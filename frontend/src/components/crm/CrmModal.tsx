'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';

/** Modal shell for the Partner CRM: overlay, header, scrolling body, footer. */
export default function CrmModal({
  title, subtitle, onClose, children, footer, width = 'max-w-xl', accent,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  accent?: string | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--surface-overlay)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${width} max-h-[90vh] flex flex-col`}
        style={{ background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
      >
        <div className="px-6 py-4 flex items-start gap-3 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          {accent && <span className="mt-1.5 shrink-0" style={{ width: 10, height: 10, borderRadius: 3, background: accent }} />}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>{title}</h2>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--ink-muted)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-6 py-3 flex items-center gap-3 shrink-0" style={{ borderTop: '1px solid var(--rule-subtle)' }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

export const fieldStyle: React.CSSProperties = {
  border: '1px solid var(--rule-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-sunken)',
  color: 'var(--ink-primary)',
  outline: 'none',
};

export function errDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}
