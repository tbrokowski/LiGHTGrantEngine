'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { grants } from '@/lib/api';
import FinanceHub from '@/components/grant-workspace/finance/FinanceHub';
import { useAuth, canEditFinance } from '@/lib/auth';

interface GrantDetail {
  id: string;
  title: string;
  funder?: string;
  currency?: string;
  award_amount?: number;
  grant_stage?: string;
}

function FinanceGrantContent() {
  const { grantId } = useParams<{ grantId: string }>();
  const { user } = useAuth();
  const [grant, setGrant] = useState<GrantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [myGrantRole, setMyGrantRole] = useState<string | null>(null);

  const fetchGrant = useCallback(() => {
    if (!grantId) return;
    grants.get(grantId)
      .then(r => {
        const g = r.data;
        if (g.grant_stage && !['active', 'awarded'].includes(g.grant_stage)) {
          setGrant(g);
        } else {
          setGrant(g);
        }
      })
      .catch(() => setGrant(null))
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { fetchGrant(); }, [fetchGrant]);

  useEffect(() => {
    if (!grantId || !user) return;
    grants.listMembers(grantId)
      .then(r => {
        const me = (r.data as Array<{ user_id: string | null; role: string }>).find(m => m.user_id === user.id);
        setMyGrantRole(me?.role ?? null);
      })
      .catch(() => {});
  }, [grantId, user]);

  const isGrantEditor =
    canEditFinance(user) ||
    myGrantRole === 'editor' ||
    myGrantRole === 'owner';

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading grant…</div>;
  }

  if (!grant) {
    return (
      <div className="px-6 py-16 text-center text-sm text-gray-500">
        Grant not found.{' '}
        <Link href="/finance" className="text-emerald-600 hover:underline">Back to Finance</Link>
      </div>
    );
  }

  if (grant.grant_stage && !['active', 'awarded'].includes(grant.grant_stage)) {
    return (
      <div className="px-6 py-12 max-w-lg mx-auto text-center">
        <p className="text-sm text-gray-700 font-medium">This grant is not active yet</p>
        <p className="text-xs text-gray-500 mt-2">
          Financial management is available after a grant is marked Active (awarded).
        </p>
        <Link href={`/grants/${grantId}`} className="inline-block mt-4 text-sm text-emerald-600 hover:underline">
          Open grant workspace
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto">
          <nav className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
            <Link href="/finance" className="hover:text-emerald-600">Finance</Link>
            <span>/</span>
            <span className="text-gray-600 truncate">{grant.title}</span>
          </nav>
          <h2 className="text-lg font-semibold text-gray-900">{grant.title}</h2>
          {grant.funder && <p className="text-sm text-gray-500 mt-0.5">{grant.funder}</p>}
        </div>
      </div>
      <FinanceHub
        grantId={grantId}
        grantTitle={grant.title}
        currency={grant.currency}
        isEditor={isGrantEditor}
      />
    </div>
  );
}

export default function FinanceGrantPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-gray-400">Loading…</div>}>
      <FinanceGrantContent />
    </Suspense>
  );
}
