'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus, X, Check } from 'lucide-react';
import { feedback } from '@/lib/api';

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'bug', label: 'Bug' },
  { id: 'concern', label: 'Concern' },
  { id: 'idea', label: 'Idea' },
  { id: 'revision', label: 'Revision' },
  { id: 'other', label: 'Other' },
];

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('bug');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const reset = () => {
    setMessage('');
    setCategory('bug');
    setStatus('idle');
  };

  const close = () => {
    setOpen(false);
    // Give the panel time to animate out before clearing a success state.
    setTimeout(reset, 200);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus('sending');
    try {
      await feedback.submit({ category, message: message.trim(), page_url: pathname });
      setStatus('sent');
      setTimeout(close, 1400);
    } catch {
      setStatus('error');
    }
  }

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        aria-label="Send feedback"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-[60] w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--accent-primary, #1c3c72)', color: '#fff' }}
      >
        {open ? <X className="w-5 h-5" /> : <MessageSquarePlus className="w-5 h-5" />}
      </button>

      {/* Popup panel */}
      {open && (
        <div
          className="fixed bottom-20 right-5 z-[60] w-80 rounded-2xl overflow-hidden"
          style={{
            background: 'var(--surface-panel, #fff)',
            border: '1px solid var(--rule-subtle, #e5e7eb)',
            boxShadow: 'var(--shadow-floating, 0 12px 32px rgba(0,0,0,0.18))',
          }}
        >
          {status === 'sent' ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: 'var(--state-success-bg, #dcfce7)', color: 'var(--state-success, #16a34a)' }}
              >
                <Check className="w-5 h-5" />
              </span>
              <p className="text-sm font-medium" style={{ color: 'var(--ink-primary, #111827)' }}>Thanks — sent!</p>
              <p className="text-xs" style={{ color: 'var(--ink-muted, #6b7280)' }}>
                Your note has been logged and emailed.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary, #111827)' }}>
                  Share feedback
                </h3>
                <button type="button" onClick={close} style={{ color: 'var(--ink-faint, #9ca3af)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Category chips */}
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const active = category === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                      style={
                        active
                          ? { background: 'var(--accent-primary, #1c3c72)', color: '#fff', borderColor: 'var(--accent-primary, #1c3c72)' }
                          : { background: 'transparent', color: 'var(--ink-muted, #6b7280)', borderColor: 'var(--rule-subtle, #e5e7eb)' }
                      }
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>

              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Describe the bug, concern, or idea…"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none resize-y"
                style={{
                  background: 'var(--surface-sunken, #f9fafb)',
                  border: '1px solid var(--rule-subtle, #e5e7eb)',
                  color: 'var(--ink-primary, #111827)',
                }}
              />

              {status === 'error' && (
                <p className="text-xs" style={{ color: 'var(--state-danger, #dc2626)' }}>
                  Couldn’t send — please try again.
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'sending' || !message.trim()}
                className="w-full text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent-primary, #1c3c72)', color: '#fff' }}
              >
                {status === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
