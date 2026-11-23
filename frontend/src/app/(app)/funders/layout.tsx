'use client';

import Link from 'next/link';
import { useAuth, canUseFunders } from '@/lib/auth';

export default function FundersLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>;
  }

  if (!canUseFunders(user)) {
    return (
      <div className="px-8 py-16 text-center text-sm max-w-md mx-auto" style={{ color: 'var(--ink-muted)' }}>
        <p className="font-medium mb-2" style={{ color: 'var(--ink-primary)' }}>Funders</p>
        <p>The Funders tab isn&apos;t switched on for this organization, or you don&apos;t have access to Partners.</p>
        <Link href="/partners" className="inline-block mt-4 text-sm hover:underline" style={{ color: 'var(--ink-secondary)' }}>
          Go to Partners
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
