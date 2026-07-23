export interface Opportunity {
  id: string;
  title: string;
  funder: string | null;
  opportunity_type: string | null;
  deadline: string | null;
  fit_score: number | null;
  priority: string | null;
  status: string;
  thematic_areas: string[];
  geography: string[];
  award_min: number | null;
  award_max: number | null;
  currency: string | null;
  short_summary: string | null;
  description: string | null;
  has_description: boolean;
  funder_logo_url: string | null;
  opportunity_url: string | null;
  source_id: string | null;
  funder_org_id?: string | null;
  fit_rationale?: string | null;
  is_read?: boolean;
  is_personal_shortlisted?: boolean;
  is_on_org_shortlist?: boolean;
  outcome?: 'awarded' | 'declined' | 'not_pursued' | null;
  outcome_recorded_at?: string | null;
  shortlist_category_id?: string | null;
}

export interface ShortlistCategory {
  id: string;
  scope: 'user' | 'org';
  name: string;
  color: string | null;
  position: number;
}

export interface OpportunityFilters {
  search: string;
  priority: string;
  theme: string;
  opportunityType: string;
  geography: string;
  funder: string;
  funderCategory: string;
  priorityFunderGroup: string;
  sourceId: string;
  funderOrgId: string;
  deadlineBefore: string;
  deadlineAfter: string;
  awardMin: string;
  awardMax: string;
  hasDeadline: boolean;
  sortBy: 'relevance' | 'deadline' | 'award';
}

export interface FilterOptions {
  funders: { name: string; logo_url: string | null }[];
  opportunity_types: string[];
  geographies: string[];
  thematic_areas: string[];
  source_categories: string[];
  sources: { id: string; name: string; category: string | null; logo_url: string | null }[];
  funder_orgs: { id: string; name: string }[];
}

export const PRIORITY_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  // legacy values
  high_priority: 'High',
  worth_reviewing: 'Medium',
  watchlist: 'Low',
  low_fit: 'Low',
};

export const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
  // legacy values
  high_priority: 'bg-emerald-100 text-emerald-700',
  worth_reviewing: 'bg-amber-100 text-amber-700',
  watchlist: 'bg-gray-100 text-gray-500',
  low_fit: 'bg-gray-100 text-gray-500',
};

export const THEME_OPTIONS = [
  'AI for health',
  'clinical AI',
  'global health',
  'digital health',
  'LMIC',
  'humanitarian',
  'machine learning',
  'medical imaging',
  'POCUS',
  'ultrasound',
  'tuberculosis',
  'TB',
  'maternal health',
  'newborn health',
  'implementation science',
  'responsible AI',
  'federated learning',
  'edge AI',
];

export function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

export function formatAward(min: number | null, max: number | null, currency: string | null) {
  const c = currency ?? 'USD';
  if (max) return `${c} ${max >= 1_000_000 ? `${(max / 1_000_000).toFixed(1)}M` : max.toLocaleString()}`;
  if (min) return `${c} ${min >= 1_000_000 ? `${(min / 1_000_000).toFixed(1)}M` : min.toLocaleString()}`;
  return null;
}

export function isExpired(deadline: string | null) {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

export type ViewMode = 'table' | 'graph';
export type TabMode = 'queue' | 'shortlist' | 'org-shortlist' | 'awarded';
