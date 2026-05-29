'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { grants } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import StatusDropdown from '@/components/grant-workspace/StatusDropdown';
import GrantColorPicker from '@/components/grants/GrantColorPicker';
import FileLibrary from '@/components/grant-workspace/FileLibrary';
import BudgetPanel from '@/components/grant-workspace/BudgetPanel';
import CollaboratorsPanel from '@/components/grant-workspace/CollaboratorsPanel';
import ActiveGrantDashboard from '@/components/grant-workspace/ActiveGrantDashboard';
import MilestoneTracker from '@/components/grant-workspace/MilestoneTracker';
import type {
  WorkspaceSummary,
  Task,
  WorkspaceFile,
  BudgetTracker,
} from '@/components/grant-workspace/types';

const TasksHub = dynamic(() => import('@/components/grant-workspace/TasksHub'), {
  loading: () => <div className="flex justify-center py-16 text-sm text-gray-400">Loading tasks…</div>,
  ssr: false,
});

type ActiveTab = 'overview' | 'tasks' | 'milestones' | 'budget' | 'files' | 'team';

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'budget', label: 'Budget' },
  { id: 'files', label: 'Files' },
  { id: 'team', label: 'Team' },
];

interface GrantDetail {
  id: string;
  title: string;
  funder?: string;
  program?: string;
  pi_name?: string;
  status: string;
  grant_stage?: string;
  external_deadline?: string;
  internal_deadline?: string;
  requested_amount?: number;
  award_amount?: number;
  currency?: string;
  decision_at?: string;
  drive_folder_url?: string;
  submission_portal_url?: string;
  color?: string | null;
  is_personal?: boolean;
}

function formatDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (!amount) return null;
  const sym = currency && currency !== 'USD' ? currency : '$';
  return `${sym}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)}`;
}

function ActiveGrantWorkspaceContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if (tabParam === 'finance' && id) {
      router.replace(`/finance/${id}`);
    }
  }, [tabParam, id, router]);

  const initialTab = tabParam && TABS.some(t => t.id === tabParam) ? (tabParam as ActiveTab) : 'overview';

  const [grant, setGrant] = useState<GrantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [myGrantRole, setMyGrantRole] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Data per tab
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [budget, setBudget] = useState<BudgetTracker | null>(null);
  const [loadedTabs, setLoadedTabs] = useState<Set<ActiveTab>>(new Set(['overview', 'tasks']));

  const fetchGrant = useCallback(() => {
    if (!id) return;
    grants.get(id)
      .then(r => {
        const g = r.data;
        // If grant is not active/awarded, redirect back to the proposal view
        if (g.grant_stage && !['active', 'awarded'].includes(g.grant_stage)) {
          router.replace(`/grants/${id}`);
          return;
        }
        setGrant(g);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, router]);

  const fetchSummary = useCallback(() => {
    if (!id) return;
    grants.workspaceSummary(id).then(r => setSummary(r.data)).catch(console.error);
  }, [id]);

  const fetchTasks = useCallback(() => {
    if (!id) return;
    grants.listTasks(id).then(r => setTaskList(r.data)).catch(console.error);
  }, [id]);

  const fetchFiles = useCallback(() => {
    if (!id) return;
    grants.listFiles(id).then(r => setFiles(r.data)).catch(console.error);
  }, [id]);

  const fetchBudget = useCallback(() => {
    if (!id) return;
    grants.getBudget(id).then(r => setBudget(r.data)).catch(console.error);
  }, [id]);

  useEffect(() => {
    fetchGrant();
    fetchSummary();
    fetchTasks();
  }, [fetchGrant, fetchSummary, fetchTasks]);

  useEffect(() => {
    if (!id || !user) return;
    grants.listMembers(id)
      .then(r => {
        const me = (r.data as Array<{ user_id: string | null; role: string }>).find(m => m.user_id === user.id);
        setMyGrantRole(me?.role ?? null);
      })
      .catch(() => {});
  }, [id, user]);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (loadedTabs.has(tab)) return;
    setLoadedTabs(prev => new Set([...prev, tab]));
    if (tab === 'files') fetchFiles();
    if (tab === 'budget') fetchBudget();
  };

  const refreshTasks = useCallback(() => {
    fetchTasks();
    fetchSummary();
  }, [fetchTasks, fetchSummary]);

  const handleStatusChange = useCallback((newStatus: string) => {
    setGrant(g => g ? { ...g, status: newStatus } : g);
  }, []);

  const handleColorChange = useCallback(async (color: string | null) => {
    if (!id) return;
    setGrant(g => g ? { ...g, color } : g);
    setShowColorPicker(false);
    try { await grants.update(id, { color }); }
    catch { fetchGrant(); }
  }, [id, fetchGrant]);

  const handleDeadlineChange = useCallback(async (newDeadline: string | null) => {
    if (!id) return;
    try {
      await grants.update(id, { external_deadline: newDeadline });
      setGrant(g => g ? { ...g, external_deadline: newDeadline ?? undefined } : g);
      fetchSummary();
    } catch {
      alert('Failed to save deadline.');
      fetchGrant();
    }
  }, [id, fetchGrant, fetchSummary]);

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

  const isOrgAdmin = user?.institution_role === 'admin';
  const isGrantEditor = isOrgAdmin || user?.role === 'grant_lead' || myGrantRole === 'editor' || myGrantRole === 'owner';
  const awardDisplay = formatCurrency(grant.award_amount, grant.currency);
  const awardedDate = formatDate(grant.decision_at);

  return (
    <div className="flex flex-col min-h-0">

      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-0 border-b border-gray-200 bg-white shrink-0">
        <div className="max-w-7xl mx-auto">

          {/* Breadcrumb + links */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Link href="/grants" className="hover:text-gray-700 transition-colors">Grants</Link>
              <span className="text-gray-300">/</span>
              <span className="text-gray-600 truncate max-w-xs">{grant.title}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {grant.drive_folder_url && (
                <a href={grant.drive_folder_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-emerald-600 flex items-center gap-1 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
                  </svg>
                  Drive
                </a>
              )}
              {grant.submission_portal_url && (
                <a href={grant.submission_portal_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-emerald-600 transition-colors">
                  Portal
                </a>
              )}
            </div>
          </div>

          {/* Title row */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0 flex items-start gap-2.5">
              {/* Color swatch */}
              <div className="relative shrink-0 mt-1">
                <button
                  type="button"
                  title="Grant color"
                  onClick={() => setShowColorPicker(v => !v)}
                  className="w-4 h-4 rounded-full border-2 border-white shadow ring-1 ring-gray-200 hover:ring-emerald-400 transition-all mt-0.5"
                  style={{ backgroundColor: grant.color ?? '#10b981' }}
                />
                {showColorPicker && (
                  <div className="absolute left-0 top-7 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-max">
                    <GrantColorPicker value={grant.color} onChange={handleColorChange} label="" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                  {awardDisplay && (
                    <span className="text-xs font-bold text-emerald-700">{awardDisplay}</span>
                  )}
                  {awardedDate && (
                    <span className="text-xs text-gray-400">awarded {awardedDate}</span>
                  )}
                </div>
                <h1 className="text-lg font-semibold text-gray-900 leading-tight truncate">{grant.title}</h1>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  {grant.funder && <span className="text-sm text-gray-500">{grant.funder}</span>}
                  {grant.program && (
                    <>
                      <span className="text-gray-300 text-sm">·</span>
                      <span className="text-sm text-gray-400">{grant.program}</span>
                    </>
                  )}
                  {grant.pi_name && (
                    <>
                      <span className="text-gray-300 text-sm">·</span>
                      <span className="text-sm text-gray-400">PI: {grant.pi_name}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="shrink-0 pt-0.5">
              <StatusDropdown
                grantId={id}
                status={grant.status}
                onStatusChange={handleStatusChange}
                readOnly={!isGrantEditor}
              />
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <div className="max-w-7xl mx-auto overflow-x-auto">
          <div className="flex border-b-0 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto">

          {/* Overview */}
          {activeTab === 'overview' && summary && (
            <ActiveGrantDashboard
              grant={{
                id: grant.id,
                title: grant.title,
                funder: grant.funder,
                pi_name: grant.pi_name,
                award_amount: grant.award_amount,
                currency: grant.currency,
                external_deadline: grant.external_deadline,
                decision_at: grant.decision_at,
                color: grant.color,
              }}
              summary={summary}
              tasks={taskList}
              onTabChange={(tab) => handleTabChange(tab as ActiveTab)}
              onDeadlineChange={isGrantEditor ? handleDeadlineChange : undefined}
            />
          )}
          {activeTab === 'overview' && !summary && (
            <div className="flex justify-center py-16 text-sm text-gray-400">Loading overview…</div>
          )}

          {/* Tasks */}
          {activeTab === 'tasks' && (
            <TasksHub
              grantId={id}
              tasks={taskList}
              onRefresh={refreshTasks}
              grantColor={grant.color ?? undefined}
            />
          )}

          {/* Milestones + Reporting */}
          {activeTab === 'milestones' && (
            <MilestoneTracker
              grantId={id}
              allTasks={taskList}
              onTasksRefresh={refreshTasks}
            />
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

          {/* Files */}
          {activeTab === 'files' && (
            <FileLibrary grantId={id} files={files} onRefresh={fetchFiles} />
          )}

          {/* Team */}
          {activeTab === 'team' && (
            <CollaboratorsPanel grantId={id} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActiveGrantWorkspacePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>}>
      <ActiveGrantWorkspaceContent />
    </Suspense>
  );
}
