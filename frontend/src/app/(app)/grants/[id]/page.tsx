'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { grants } from '@/lib/api';
import GrantEditor from '@/components/grant-editor/GrantEditor';
import type { EditorSection } from '@/lib/types';
import WorkspaceNav, { WorkspaceTab } from '@/components/grant-workspace/WorkspaceNav';
import WorkspaceDashboard from '@/components/grant-workspace/WorkspaceDashboard';
import TasksHub from '@/components/grant-workspace/TasksHub';
import FileLibrary from '@/components/grant-workspace/FileLibrary';
import BudgetPanel from '@/components/grant-workspace/BudgetPanel';
import MoreTab from '@/components/grant-workspace/MoreTab';
import CollaboratorsPanel from '@/components/grant-workspace/CollaboratorsPanel';
import TaskTimeline from '@/components/grant-workspace/TaskTimeline';
import StatusDropdown from '@/components/grant-workspace/StatusDropdown';
import type {
  WorkspaceSummary,
  Task,
  WorkspaceFile,
  BudgetTracker,
} from '@/components/grant-workspace/types';

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
  proposal_skeleton?: Record<string, unknown>;
  style_profile?: Record<string, unknown>;
  writing_phase?: string;
  last_review?: Record<string, unknown>;
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

function GrantDetailContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as WorkspaceTab) ?? 'overview';

  const [grant, setGrant] = useState<GrantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);

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
        if (!tabParam) {
          const draftingStatuses = ['full_proposal_drafting', 'concept_note_drafting'];
          if (draftingStatuses.includes(r.data.status)) {
            setActiveTab('editor');
            setLoadedTabs((prev) => new Set([...prev, 'editor']));
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, searchParams]);

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

  return (
    <div className={isEditorTab ? 'h-full flex flex-col' : 'flex flex-col min-h-0'}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-0 border-b border-gray-200 bg-white shrink-0">
        <div className="max-w-7xl mx-auto">

          {/* Row 1: breadcrumb + action links */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Link href="/grants" className="hover:text-gray-700 transition-colors">Grants</Link>
              <span className="text-gray-300">/</span>
              <span className="text-gray-600 truncate max-w-xs">{grant.title}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {grant.call_url && (
                <a href={grant.call_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 3h3v3m0-3L7 9M4 4H3a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-1" />
                  </svg>
                  Call
                </a>
              )}
              {grant.google_doc_url && (
                <a href={grant.google_doc_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h6l2 2v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
                  </svg>
                  Google Doc
                </a>
              )}
              {grant.drive_folder_url && (
                <a href={grant.drive_folder_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
                  </svg>
                  Drive
                </a>
              )}
              {grant.submission_portal_url && (
                <a href={grant.submission_portal_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-indigo-600 transition-colors">
                  Portal
                </a>
              )}
            </div>
          </div>

          {/* Row 2: title + status + metadata */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-gray-900 leading-tight truncate">{grant.title}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {grant.funder && <span className="text-sm text-gray-500">{grant.funder}</span>}
                {grant.program && (
                  <>
                    <span className="text-gray-300 text-sm">·</span>
                    <span className="text-sm text-gray-400">{grant.program}</span>
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 pt-0.5">
              <StatusDropdown
                grantId={id}
                status={grant.status}
                onStatusChange={handleStatusChange}
              />
            </div>
          </div>

          {/* Row 3: metadata strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs">
            {grant.pi_name && (
              <span className="text-gray-500">
                <span className="text-gray-400">PI </span>
                <span className="font-medium text-gray-700">{grant.pi_name}</span>
              </span>
            )}
            {grant.internal_deadline && (
              <DeadlineChip label="Internal" date={grant.internal_deadline} />
            )}
            {grant.external_deadline && (
              <DeadlineChip label="Deadline" date={grant.external_deadline} />
            )}
            {grant.requested_amount != null && (
              <span className="text-gray-500">
                <span className="text-gray-400">Amount </span>
                <span className="font-medium text-gray-700">
                  {grant.currency ?? 'USD'} {grant.requested_amount.toLocaleString()}
                </span>
              </span>
            )}
            {grant.priority && grant.priority !== 'medium' && (
              <span className={`font-medium capitalize ${PRIORITY_COLORS[grant.priority] ?? 'text-gray-500'}`}>
                {grant.priority}
              </span>
            )}
          </div>
        </div>

        {/* Tab nav */}
        <div className="max-w-7xl mx-auto">
          <WorkspaceNav activeTab={activeTab} onChange={handleTabChange} />
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
                  <TaskTimeline tasks={taskList} compact={true} />
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
