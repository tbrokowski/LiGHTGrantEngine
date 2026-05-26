'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { auth } from '@/lib/api';

export default function EmailVerificationBanner() {
  const { user } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!user || user.email_verified || dismissed) return null;

  async function handleResend() {
    setSending(true);
    try {
      await auth.sendVerification();
      setSent(true);
    } catch {
      // fail silently
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-amber-800 truncate">
          {sent
            ? 'Verification email sent. Check your inbox.'
            : `Please verify your email address (${user.email}) to unlock all features.`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!sent && (
          <button
            type="button"
            onClick={handleResend}
            disabled={sending}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 border border-amber-300 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Resend email'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-700 p-0.5 rounded transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
