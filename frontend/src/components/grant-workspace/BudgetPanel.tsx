'use client';

import BudgetWorkbooks from './BudgetWorkbooks';

/** A grant's Budget tab: shared budget spreadsheets (blank or uploaded Excel). */
export default function BudgetPanel({ grantId, canEdit = true }: { grantId: string; canEdit?: boolean }) {
  return (
    <div className="p-4">
      <BudgetWorkbooks grantId={grantId} canEdit={canEdit} />
    </div>
  );
}
