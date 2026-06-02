'use client';

import Link from 'next/link';
import { useAuth, hasModulePermission } from '@/lib/auth';

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
  }

  if (!hasModulePermission(user, 'can_view_partners')) {
    return (
      <div className="px-8 py-16 text-center text-sm text-gray-500 max-w-md mx-auto">
        <p className="font-medium text-gray-800 mb-2">Partners module</p>
        <p>You do not have permission to access Partners. Ask an org admin to enable Partners under Settings → Members.</p>
        <Link href="/dashboard" className="inline-block mt-4 text-sm text-emerald-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
