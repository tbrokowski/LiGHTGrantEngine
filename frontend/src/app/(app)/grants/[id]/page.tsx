'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { grants } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { EditorSection } from '@/lib/types';
import WorkspaceNav, { WorkspaceTab } from '@/components/grant-workspace/WorkspaceNav';
import WorkspaceDashboard from '@/components/grant-workspace/WorkspaceDashboard';
import GrantColorPicker from '@/components/grants/GrantColorPicker';
import FileLibrary from '@/components/grant-workspace/FileLibrary';
import BudgetPanel from '@/components/grant-workspace/BudgetPanel';
import MoreTab from '@/components/grant-workspace/MoreTab';
import CollaboratorsPanel from '@/components/grant-workspace/CollaboratorsPanel';
import StatusDropdown from '@/components/grant-workspace/StatusDropdown';
import WorkPackagePanel from '@/components/workspace/WorkPackagePanel';
import ReportingSchedule from '@/components/workspace/ReportingSchedule';
import type {
  WorkspaceSummary,
  Task,
  WorkspaceFile,
  BudgetTracker,
} from '@/components/grant-workspace/types';

const GrantEditor = dynamic(() => import('@/components/grant-editor/GrantEditor'), {
  loading: () => <div className="flex justify-center py-24 text-sm text-gray-400">Loading editor…</div>,
  ssr: false,
});

const TasksHub = dynamic(() => import('@/components/grant-workspace/TasksHub'), {
  loading: () => <div className="flex justify-center py-24 text-sm text-gray-400">Loading tasks…</div>,
  ssr: false,
});

const TaskTimeline = dynamic(() => import('@/components/grant-workspace/TaskTimeline'), {
  loading: () => <div className="flex justify-center py-8 text-sm text-gray-400">Loading timeline…</div>,
  ssr: false,
});

export type { EditorSection };

interface GrantDetail {
  id: string;
  title: string;
  funder?: string;
  program?: string;
  call_url?: string;
  pi_name?: string;
  status: string;
  priority?: string;
  grant_stage?: string;
  external_deadline?: string;
  internal_deadline?: string;
  requested_amount?: number;
  currency?: string;
  themes?: string[];
  geographies?: string[];
  notes?: string;
  drive_folder_url?: string;
  proposal_draft_url?: string;
  budget_url?: string;
  submission_portal_url?: string;
  call_requirements?: string;
  editor_sections: Record<string, EditorSection>;
  editor_document?: string | null;
  google_doc_id?: string | null;
  google_doc_url?: string | null;
  google_doc_last_synced?: string | null;
  grant_idea?: string | null;
  call_analysis?: Record<string, unknown>;
  call_intelligence?: Record<string, unknown> | null;
  proposal_skeleton?: Record<string, unknown>;
  style_profile?: Record<string, unknown>;
  writing_phase?: string;
  last_review?: Record<string, unknown>;
  is_personal?: boolean;
  color?: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  critical: 'text-red-600 font-semibold',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const diff = new Date(d + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / 86400000);
}

function DeadlineChip({ label, date }: { label: string; date: string }) {
  const days = daysUntil(date);
  const urgent = days !== null && days <= 14;
  const overdue = days !== null && days < 0;
  return (
    <span className={`text-xs ${overdue ? 'text-red-600' : urgent ? 'text-amber-600' : 'text-gray-500'}`}>
      <span className="text-gray-400">{label} </span>
      <span className="font-medium">{formatDate(date)}</span>
      {days !== null && (
        <span className={`ml-1 ${overdue ? 'text-red-500' : urgent ? 'text-amber-500' : 'text-gray-400'}`}>
          ({overdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `${days}d`})
        </span>
      )}
    </span>
  );
}

const ACTIVE_STAGES = ['active', 'awarded'];

const ACTIVE_WORKSPACE_TABS = new Set([
  'overview', 'tasks', 'milestones', 'budget', 'finance', 'files', 'team',
]);

/** Map proposal workspace tab query params to active-grant workspace tabs. */
function activeWorkspaceTabFromParam(tab: string | null): string | null {
  if (!tab) return null;
  if (ACTIVE_WORKSPACE_TABS.has(tab)) return tab;
  if (tab === 'editor' || tab === 'planning' || tab === 'more') return 'overview';
  return null;
}

function GrantDetailContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as WorkspaceTab) ?? 'overview';
  const { user } = useAuth();

  const [grant, setGrant] = useState<GrantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [myGrantRole, setMyGrantRole] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Workspace data
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [budget, setBudget] = useState<BudgetTracker | null>(null);

  // Track which lazy tabs have been loaded
  const [loadedTabs, setLoadedTabs] = useState<Set<WorkspaceTab>>(new Set(['overview', 'tasks']));
  const [documentHeadings, setDocumentHeadings] = useState<string[]>([]);

  const fetchGrant = useCallback(() => {
    if (!id) return;
    grants.get(id)
      .then((r) => {
        setGrant(r.data);
        const tabParam = searchParams.get('tab');

        // Active/awarded grants live at /workspace (finance tab, milestones, etc.)
        const isBaseRoute = !pathname.endsWith('/write') && !pathname.endsWith('/workspace');
        if (isBaseRoute) {
          const stage = r.data.grant_stage;
          if (stage && ACTIVE_STAGES.includes(stage)) {
            const wTab = activeWorkspaceTabFromParam(tabParam);
            const qs = wTab ? `?tab=${wTab}` : '';
            router.replace(`/grants/${id}/workspace${qs}`);
            return;
          } else if (!tabParam) {
            const draftingStatuses = ['full_proposal_drafting', 'concept_note_drafting'];
            if (draftingStatuses.includes(r.data.status)) {
              setActiveTab('editor');
              setLoadedTabs((prev) => new Set([...prev, 'editor']));
            }
          }
        }

        // Set default tab based on sub-route
        if (pathname.endsWith('/write') && !tabParam) {
          setActiveTab('editor');
          setLoadedTabs((prev) => new Set([...prev, 'editor']));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, searchParams, pathname, router]);

  const fetchSummary = useCallback(() => {
    if (!id) return;
    grants.workspaceSummary(id).then((r) => setSummary(r.data)).catch(console.error);
  }, [id]);

  const fetchTasks = useCallback(() => {
    if (!id) return;
    grants.listTasks(id).then((r) => setTaskList(r.data)).catch(console.error);
  }, [id]);

  const fetchFiles = useCallback(() => {
    if (!id) return;
    grants.listFiles(id).then((r) => setFiles(r.data)).catch(console.error);
  }, [id]);

  const fetchBudget = useCallback(() => {
    if (!id) return;
    grants.getBudget(id).then((r) => setBudget(r.data)).catch(console.error);
  }, [id]);

  // Load grant member role for the current user
  useEffect(() => {
    if (!id || !user) return;
    grants.listMembers(id)
      .then(r => {
        const me = (r.data as Array<{ user_id: string | null; role: string }>).find(m => m.user_id === user.id);
        setMyGrantRole(me?.role ?? null);
      })
      .catch(() => {});
  }, [id, user]);

  // Load grant, summary, and tasks on mount
  useEffect(() => {
    fetchGrant();
    fetchSummary();
    fetchTasks();
  }, [fetchGrant, fetchSummary, fetchTasks]);

  const handleTabChange = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    if (loadedTabs.has(tab)) return;
    setLoadedTabs((prev) => new Set([...prev, tab]));
    if (tab === 'files') fetchFiles();
    if (tab === 'budget') fetchBudget();
  };

  const refreshTasks = useCallback(() => {
    fetchTasks();
    fetchSummary();
  }, [fetchTasks, fetchSummary]);

  const handleStatusChange = useCallback((newStatus: string) => {
    setGrant((g) => g ? { ...g, status: newStatus } : g);
  }, []);

  const handleColorChange = useCallback(async (color: string | null) => {
    if (!id) return;
    setGrant((g) => g ? { ...g, color } : g);
    setShowColorPicker(false);
    try {
      await grants.update(id, { color });
    } catch {
      // revert on failure
      fetchGrant();
    }
  }, [id, fetchGrant]);

  async function handlePromote() {
    if (!id) return;
    if (!confirm('Promote this draft to your organization\'s portfolio? It will become visible to other org members.')) return;
    setPromoting(true);
    try {
      await grants.promote(id);
      fetchGrant();
    } catch {
      alert('Failed to promote. Make sure you belong to an organization.');
    } finally {
      setPromoting(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
  }
  if (!grant) {
    return (
      <div className="px-8 py-16 text-center text-gray-500 text-sm">
        Grant not found.{' '}
        <Link href="/grants" className="text-blue-600 hover:underline">Back to grants</Link>
      </div>
    );
  }

  const isEditorTab = activeTab === 'editor';
  const isOrgAdmin = user?.institution_role === 'admin';
  const isGrantEditor = isOrgAdmin || user?.role === 'grant_lead' || myGrantRole === 'editor' || myGrantRole === 'owner';

  return (
    <div className={isEditorTab ? 'h-full flex flex-col' : 'flex flex-col min-h-0'}>
      {/* ── Personal draft banner ───────────────────────────────────────────── */}
      {grant.is_personal && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-2.5 bg-amber-50 border-b border-amber-100 text-sm">
          <div className="flex items-center gap-2 text-amber-700">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="font-medium">Personal draft</span>
            <span className="text-amber-600 font-normal">— only you can see this grant. Promote it to share with your organization.</span>
          </div>
          <button
            onClick={handlePromote}
            disabled={promoting}
            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {promoting ? 'Promoting…' : 'Promote to organization'}
          </button>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-3 pb-0 border-b border-gray-200 bg-white shrink-0">
        <div className="max-w-7xl mx-auto">

          {/* Single row: color swatch + title + funder + metadata + status + tab nav */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Color swatch / picker */}
            <div className="relative shrink-0">
              <button
                type="button"
                title="Grant color"
                onClick={() => setShowColorPicker((v) => !v)}
                className="w-3.5 h-3.5 rounded-full border-2 border-white shadow ring-1 ring-gray-200 hover:ring-gray-400 transition-all"
                style={{ backgroundColor: grant.color ?? '#e5e7eb' }}
              />
              {showColorPicker && (
                <div className="absolute left-0 top-6 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-max">
                  <GrantColorPicker value={grant.color} onChange={handleColorChange} label="" />
                </div>
              )}
            </div>

            {/* Title + funder */}
            <div className="min-w-0 flex items-baseline gap-2 shrink-0 max-w-[260px]">
              <h1 className="text-sm font-semibold text-gray-900 truncate leading-none">{grant.title}</h1>
              {grant.funder && (
                <span className="text-xs text-gray-400 truncate shrink-0">{grant.funder}</span>
              )}
            </div>

            {/* Metadata chips */}
            <div className="hidden md:flex items-center gap-x-3 text-xs shrink-0">
              {grant.external_deadline && (
                <DeadlineChip label="Deadline" date={grant.external_deadline} />
              )}
              {grant.requested_amount != null && (
                <span className="text-gray-400">
                  {grant.currency ?? 'USD'} {grant.requested_amount.toLocaleString()}
                </span>
              )}
            </div>

            {/* Status + external links */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <StatusDropdown
                grantId={id}
                status={grant.status}
                onStatusChange={handleStatusChange}
                readOnly={!isGrantEditor}
              />
              {grant.call_url && (
                <a href={grant.call_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">Call</a>
              )}
              {grant.drive_folder_url && (
                <a href={grant.drive_folder_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">Drive</a>
              )}
            </div>

            {/* Tab nav — inline, right side */}
            <div className="ml-auto flex-shrink-0">
              <WorkspaceNav activeTab={activeTab} onChange={handleTabChange} compact />
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      {isEditorTab ? (
        <div className="flex-1 overflow-hidden">
          <GrantEditor
            grant={{
              id: grant.id,
              title: grant.title,
              funder: grant.funder ?? null,
              call_requirements: grant.call_requirements ?? null,
              editor_sections: grant.editor_sections ?? {},
              editor_document: grant.editor_document,
              google_doc_id: grant.google_doc_id,
              google_doc_url: grant.google_doc_url,
              google_doc_last_synced: grant.google_doc_last_synced,
              grant_idea: grant.grant_idea ?? null,
              call_analysis: grant.call_analysis ?? {},
              call_intelligence: grant.call_intelligence ?? null,
              proposal_skeleton: grant.proposal_skeleton ?? {},
              writing_phase: grant.writing_phase ?? null,
              style_profile: grant.style_profile ?? {},
              last_review: grant.last_review ?? null,
            }}
            onGrantUpdate={fetchGrant}
            onHeadingsChange={setDocumentHeadings}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto">

            {/* Overview */}
            {activeTab === 'overview' && (
              <div className="p-4 space-y-6">
                {summary ? (
                  <WorkspaceDashboard
                    summary={summary}
                    onTabChange={(tab) => handleTabChange(tab as WorkspaceTab)}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {grant.themes && grant.themes.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Themes</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {grant.themes.map((t) => (
                            <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {grant.notes && (
                      <div className="bg-white border border-gray-200 rounded-xl p-5 md:col-span-2">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{grant.notes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Task Timeline */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">Project Timeline</h3>
                    <button
                      onClick={() => handleTabChange('tasks')}
                      className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                    >
                      Manage tasks →
                    </button>
                  </div>
                  <TaskTimeline tasks={taskList} compact={true} grantColor={grant.color ?? undefined} />
                </div>
              </div>
            )}

            {/* Tasks */}
            {activeTab === 'tasks' && (
              <TasksHub
                grantId={id}
                tasks={taskList}
                onRefresh={refreshTasks}
                documentHeadings={documentHeadings}
                grantColor={grant.color ?? undefined}
              />
            )}

            {/* Files */}
            {activeTab === 'files' && (
              <FileLibrary grantId={id} files={files} onRefresh={fetchFiles} />
            )}

            {/* Budget */}
            {activeTab === 'budget' && (
              <div className="p-4">
                <BudgetPanel
                  grantId={id}
                  budget={budget}
                  onRefresh={fetchBudget}
                  grantTitle={grant.title}
                />
              </div>
            )}

            {/* Team */}
            {activeTab === 'team' && (
              <CollaboratorsPanel grantId={id} />
            )}

            {/* Planning (Work Packages + Reporting) */}
            {activeTab === 'planning' && (
              <div className="p-4 space-y-8">
                <WorkPackagePanel grantId={id} />
                <ReportingSchedule grantId={id} />
              </div>
            )}

            {/* More */}
            {activeTab === 'more' && (
              <MoreTab
                grantId={id}
                onOpenEditor={() => handleTabChange('editor')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GrantDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>}>
      <GrantDetailContent />
    </Suspense>
  );
}
