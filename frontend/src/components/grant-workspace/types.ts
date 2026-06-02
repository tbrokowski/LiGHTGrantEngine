export interface WorkspaceSummary {
  grant_id: string;
  title: string;
  funder: string | null;
  status: string;
  external_deadline: string | null;
  internal_deadline: string | null;
  days_to_external_deadline: number | null;
  days_to_internal_deadline: number | null;
  total_tasks: number;
  complete_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  due_this_week_tasks: number;
  completion_percentage: number;
  total_sections: number;
  complete_sections: number;
  total_checklist_items: number;
  complete_checklist_items: number;
  pending_partners: number;
  upcoming_milestones: Milestone[];
  budget_status: string;
  finance_status?: {
    enabled: boolean;
    status?: string;
    utilization_pct?: number;
    total_available?: number;
    pending_requests?: number;
    currency?: string;
  } | null;
}

export interface LedgerCategoryRow {
  id: string;
  ledger_id: string;
  name: string;
  approved_amount: number;
  description?: string | null;
  display_order: number;
  spent_amount: number;
  committed_amount: number;
  available_amount: number;
  utilization_pct: number;
}

export interface GrantLedgerResponse {
  ledger: {
    id: string;
    grant_id: string;
    total_awarded: number | null;
    currency: string;
    start_date?: string | null;
    end_date?: string | null;
    notes?: string | null;
  };
  categories: LedgerCategoryRow[];
  summary: {
    total_approved: number;
    total_spent: number;
    total_committed: number;
    total_available: number;
    utilization_pct: number;
  };
}

export interface FundRequestRow {
  id: string;
  grant_id: string;
  category_id: string | null;
  requested_by_id: string;
  title: string;
  description: string | null;
  vendor: string | null;
  amount: number;
  currency: string;
  status: string;
  approved_by_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface ExpenditureRow {
  id: string;
  grant_id: string;
  category_id: string | null;
  fund_request_id: string | null;
  amount: number;
  currency: string;
  expense_date: string | null;
  vendor: string | null;
  description: string | null;
  receipt_url: string | null;
  recorded_by_id: string;
  created_at: string;
}

export interface Task {
  id: string;
  grant_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  reviewer_id: string | null;
  assignee_ids: string[];
  start_date: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  task_type: string;
  estimated_effort: number | null;
  dependencies: string[];
  document_url: string | null;
  linked_section_id: string | null;
  linked_milestone_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Milestone {
  id: string;
  grant_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  target_date: string | null;
  completion_date: string | null;
  status: string;
  linked_tasks: string[];
  notes: string | null;
}

export interface GanttItem {
  id: string;
  grant_id: string;
  linked_task_id: string | null;
  linked_milestone_id: string | null;
  title: string;
  item_type: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  owner_id: string | null;
  dependency_ids: string[];
  display_order: number;
  color_category: string | null;
  work_package?: string | null;
}

export interface WorkspaceSection {
  id: string;
  grant_id: string;
  title: string;
  section_type: string;
  requirement_text: string | null;
  word_limit: number | null;
  page_limit: number | null;
  owner_id: string | null;
  reviewer_id: string | null;
  status: string;
  due_date: string | null;
  linked_document_url: string | null;
  current_word_count: number;
  compliance_status: string;
  notes: string | null;
  display_order: number;
}

export interface ChecklistItem {
  id: string;
  grant_id: string;
  title: string;
  description: string | null;
  category: string;
  required: boolean;
  owner_id: string | null;
  due_date: string | null;
  status: string;
  linked_document_url: string | null;
  evidence_url: string | null;
  notes: string | null;
  display_order: number;
}

export interface WorkspaceFile {
  id: string;
  grant_id: string;
  file_name: string;
  file_type: string | null;
  file_category: string;
  file_url: string;
  source_type: string;
  version: string;
  owner_id: string | null;
  access_level: string;
  ai_retrieval_allowed: boolean;
  description: string | null;
  tags: string[];
  related_task_id: string | null;
  related_section_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface PartnerMaterial {
  id: string;
  partner_id: string;
  grant_id: string;
  material_type: string;
  title: string;
  due_date: string | null;
  status: string;
  linked_file_url: string | null;
  notes: string | null;
}

export interface WorkspacePartner {
  id: string;
  grant_id: string;
  institution_name: string;
  contact_person: string | null;
  email: string | null;
  role: string | null;
  status: string;
  notes: string | null;
  materials: PartnerMaterial[];
}

export interface BudgetTracker {
  id: string;
  grant_id: string;
  requested_amount: number | null;
  maximum_amount: number | null;
  currency: string;
  budget_owner_id: string | null;
  status: string;
  spreadsheet_url: string | null;
  justification_url: string | null;
  indirect_cost_rule: string | null;
  cost_share_required: boolean;
  notes: string | null;
}

export interface BudgetLineItem {
  description: string;
  category: string | null;
  quantity: number | null;
  unit_cost: number | null;
  total: number | null;
  call_requirement_ref: string | null;
  compliance_note: string | null;
}

export interface ActivityEntry {
  id: string;
  grant_id: string;
  entity_type: string | null;
  entity_id: string | null;
  action: string;
  actor_id: string | null;
  timestamp: string;
  description: string | null;
}

export const TASK_STATUSES = [
  { value: 'backlog', label: 'Backlog', color: 'bg-gray-100 text-gray-700' },
  { value: 'not_started', label: 'Not Started', color: 'bg-slate-100 text-slate-700' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  { value: 'needs_input', label: 'Needs Input', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'needs_review', label: 'Needs Review', color: 'bg-purple-100 text-purple-700' },
  { value: 'blocked', label: 'Blocked', color: 'bg-red-100 text-red-700' },
  { value: 'complete', label: 'Complete', color: 'bg-green-100 text-green-700' },
  { value: 'dropped', label: 'Dropped', color: 'bg-gray-100 text-gray-400' },
];

export const TASK_PRIORITIES = [
  { value: 'low', label: 'Low', color: 'text-gray-500' },
  { value: 'medium', label: 'Medium', color: 'text-blue-500' },
  { value: 'high', label: 'High', color: 'text-orange-500' },
  { value: 'critical', label: 'Critical', color: 'text-red-600' },
];

export const SECTION_STATUSES = [
  { value: 'not_started', label: 'Not Started', color: 'bg-gray-100 text-gray-600' },
  { value: 'outline_created', label: 'Outline Created', color: 'bg-slate-100 text-slate-700' },
  { value: 'drafting', label: 'Drafting', color: 'bg-blue-100 text-blue-700' },
  { value: 'needs_input', label: 'Needs Input', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'needs_review', label: 'Needs Review', color: 'bg-purple-100 text-purple-700' },
  { value: 'revising', label: 'Revising', color: 'bg-orange-100 text-orange-700' },
  { value: 'approved', label: 'Approved', color: 'bg-teal-100 text-teal-700' },
  { value: 'finalized', label: 'Finalized', color: 'bg-green-100 text-green-700' },
  { value: 'submitted', label: 'Submitted', color: 'bg-emerald-100 text-emerald-700' },
];

export const MILESTONE_STATUSES = [
  { value: 'upcoming', label: 'Upcoming', color: 'bg-blue-100 text-blue-700' },
  { value: 'at_risk', label: 'At Risk', color: 'bg-orange-100 text-orange-700' },
  { value: 'complete', label: 'Complete', color: 'bg-green-100 text-green-700' },
  { value: 'missed', label: 'Missed', color: 'bg-red-100 text-red-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-500' },
];

export const PARTNER_STATUSES = [
  { value: 'not_contacted', label: 'Not Contacted', color: 'bg-gray-100 text-gray-600' },
  { value: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-700' },
  { value: 'confirmed', label: 'Confirmed', color: 'bg-teal-100 text-teal-700' },
  { value: 'materials_requested', label: 'Materials Requested', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'materials_received', label: 'Materials Received', color: 'bg-purple-100 text-purple-700' },
  { value: 'needs_revision', label: 'Needs Revision', color: 'bg-orange-100 text-orange-700' },
  { value: 'complete', label: 'Complete', color: 'bg-green-100 text-green-700' },
  { value: 'dropped', label: 'Dropped', color: 'bg-gray-100 text-gray-400' },
];

export const BUDGET_STATUSES = [
  { value: 'not_started', label: 'Not Started', color: 'bg-gray-100 text-gray-600' },
  { value: 'shell_created', label: 'Shell Created', color: 'bg-slate-100 text-slate-700' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  { value: 'partner_budgets_pending', label: 'Partner Budgets Pending', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'internal_review', label: 'Internal Review', color: 'bg-purple-100 text-purple-700' },
  { value: 'revision_needed', label: 'Revision Needed', color: 'bg-orange-100 text-orange-700' },
  { value: 'approved', label: 'Approved', color: 'bg-teal-100 text-teal-700' },
  { value: 'finalized', label: 'Finalized', color: 'bg-green-100 text-green-700' },
  { value: 'submitted', label: 'Submitted', color: 'bg-emerald-100 text-emerald-700' },
];

export function getStatusStyle(statuses: { value: string; color: string }[], value: string): string {
  return statuses.find((s) => s.value === value)?.color ?? 'bg-gray-100 text-gray-600';
}

export function getStatusLabel(statuses: { value: string; label: string }[], value: string): string {
  return statuses.find((s) => s.value === value)?.label ?? value;
}
