'use client';
import { Suspense } from 'react';
import GrantWorkspacePage from '../page';

/**
 * Proposal writing workspace — proposal-stage grants.
 * Renders the same workspace component with the editor tab as default focus.
 * URL: /grants/[id]/write
 */
export default function GrantWritePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>}>
      <GrantWorkspacePage />
    </Suspense>
  );
}
