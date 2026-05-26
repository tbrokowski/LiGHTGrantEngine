'use client';
import { Suspense } from 'react';
import GrantWorkspacePage from '../page';

/**
 * Active grant workspace — funded/active-stage grants.
 * Renders the same workspace component with the overview tab as default focus.
 * URL: /grants/[id]/workspace
 */
export default function ActiveGrantWorkspacePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>}>
      <GrantWorkspacePage />
    </Suspense>
  );
}
