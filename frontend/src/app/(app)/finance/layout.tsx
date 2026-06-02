'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import FinanceNav from '@/components/finance/FinanceNav';
import { useAuth, canViewFinance } from '@/lib/auth';

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const path = usePathname();
  const canView = canViewFinance(user);

  if (loading) {
    return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
  }

  if (!canView) {
    return (
      <div className="px-8 py-16 text-center text-sm text-gray-500 max-w-md mx-auto">
        <p className="font-medium text-gray-800 mb-2">Finance module</p>
        <p>
          Finance is limited to organization admins, Operations Managers, and Grant Leads.
          Ask an org admin to adjust your role or Finance access under Settings → Members.
        </p>
        <Link href="/dashboard" className="inline-block mt-4 text-sm text-emerald-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const showSectionNav = !path.match(/^\/finance\/[^/]+$/);

  return (
    <div className="flex flex-col min-h-full">
      <div className="px-6 pt-6 pb-0 bg-gray-50 border-b border-gray-100">
        <div className="max-w-6xl mx-auto">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-emerald-600 uppercase mb-1">Module</p>
          <h1 className="text-xl font-semibold text-gray-900">Finance</h1>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            Post-award budgets, fund requests, expenditures, and Slack approvals
          </p>
        </div>
      </div>
      {showSectionNav && <FinanceNav />}
      <div className="flex-1">{children}</div>
    </div>
  );
}
