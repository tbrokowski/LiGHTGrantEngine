'use client';
import { useState } from 'react';

interface AIAugmentButtonProps {
  onAugment: () => Promise<void>;
  disabled?: boolean;
}

export default function AIAugmentButton({ onAugment, disabled }: AIAugmentButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    if (loading || disabled) return;
    setLoading(true);
    try {
      await onAugment();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={disabled || loading}
      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
    >
      {loading ? (
        <>
          <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          Augmenting…
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          AI Improve
        </>
      )}
    </button>
  );
}
