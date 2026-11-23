import type { GroupRef } from '@/components/crm/crmUi';
import type { TierKey } from './tiers';

/** One row of GET /funders/ — a partner with a funder tier. */
export interface FunderRow {
  id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  organization?: string | null;
  organization_id?: string | null;
  org_name?: string | null;
  org_website?: string | null;
  linkedin_url?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
  funder_tier: TierKey;
  priority: number;
  tags: string[];
  groups: GroupRef[];
  weeks: number[];
  last_touch?: string | null;
  next_contact_date?: string | null;
  open_tasks: number;
  next_task_due?: string | null;
  owner_name?: string | null;
  enrichment_status: string;
}

export type Health = { label: string; color: string; key: 'warm' | 'cooling' | 'cold' | 'none' };

/** Same thresholds as the person page's relationship health. */
export function health(lastTouch?: string | null): Health {
  if (!lastTouch) return { key: 'none', label: 'No contact yet', color: 'var(--ink-faint)' };
  const days = Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86_400_000);
  if (days < 21) return { key: 'warm', label: 'Warm', color: 'var(--state-success)' };
  if (days < 60) return { key: 'cooling', label: 'Cooling', color: 'var(--state-warning)' };
  return { key: 'cold', label: 'Cold', color: 'var(--state-danger)' };
}

export const funderHref = (id: string) => `/partners/${id}?from=funders`;

export function place(f: Pick<FunderRow, 'city' | 'country'>) {
  return [f.city, f.country].filter(Boolean).join(', ');
}
