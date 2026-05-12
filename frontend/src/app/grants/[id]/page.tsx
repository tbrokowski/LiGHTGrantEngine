'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { grants } from '@/lib/api';
import SuggestedPartners from '@/components/crm/SuggestedPartners';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date?: string;
  task_type?: string;
}

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
  decision_outcome?: string;
  award_amount?: number;
  created_at?: string;
  updated_at?: string;
  tasks?: Task[];
}

const STATUS_COLORS: Record<string, string> = {
  scoping: 'bg-gray-100 text-gray-700',
  full_proposal_drafting: 'bg-blue-100 text-blue-800',
  internal_review: 'bg-amber-100 text-amber-800',
  submitted: 'bg-green-100 text-green-800',
  awarded: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  blocked: 'bg-red-100 text-red-700',
};

function formatDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

export default function GrantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [grant, setGrant] = useState<GrantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'partners'>('overview');

  useEffect(() => {
    if (!id) return;
    grants.get(id)
      .then(r => setGrant(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex justify-center py-20 text-gray-400 text-sm">Loading…</div>;
  if (!grant) return (
    <div className="p-8 text-center text-gray-500">
      Grant not found. <Link href="/grants" className="text-blue-600 hover:underline">Back to Grants</Link>
    </div>
  );

  const completedTasks = grant.tasks?.filter(t => t.status === 'completed').length ?? 0;
  const totalTasks = grant.tasks?.length ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-4">
        <Link href="/grants" className="hover:text-blue-600">Active Grants</Link>
        <span className="mx-2">›</span>
        <span className="text-gray-700 truncate">{grant.title}</span>
      </div>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{grant.title}</h1>
            <div className="text-sm text-gray-500 mt-1">
              {grant.funder && <span>{grant.funder}</span>}
              {grant.program && <span className="ml-2 text-gray-400">· {grant.program}</span>}
              {grant.pi_name && <span className="ml-2 text-gray-400">· PI: {grant.pi_name}</span>}
            </div>
          </div>
          <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[grant.status] ?? 'bg-gray-100 text-gray-700'}`}>
            {grant.status.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {grant.external_deadline && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Ext. Deadline</div>
              <div className="text-sm font-semibold text-gray-800">{formatDate(grant.external_deadline)}</div>
            </div>
          )}
          {grant.internal_deadline && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Int. Deadline</div>
              <div className="text-sm font-semibold text-gray-800">{formatDate(grant.internal_deadline)}</div>
            </div>
          )}
          {grant.requested_amount && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Amount</div>
              <div className="text-sm font-semibold text-gray-800">
                {grant.currency} {grant.requested_amount.toLocaleString()}
              </div>
            </div>
          )}
          {totalTasks > 0 && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Tasks</div>
              <div className="text-sm font-semibold text-gray-800">{completedTasks} / {totalTasks}</div>
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="flex flex-wrap gap-2 mt-4">
          {grant.call_url && (
            <a href={grant.call_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50">
              📄 Call
            </a>
          )}
          {grant.drive_folder_url && (
            <a href={grant.drive_folder_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50">
              📁 Drive Folder
            </a>
          )}
          {grant.proposal_draft_url && (
            <a href={grant.proposal_draft_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50">
              ✏️ Draft
            </a>
          )}
          {grant.submission_portal_url && (
            <a href={grant.submission_portal_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50">
              🚀 Portal
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {(['overview', 'tasks', 'partners'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab === 'partners' ? '🤝 Partners' : tab === 'tasks' ? '✅ Tasks' : '📋 Overview'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {grant.themes && grant.themes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Themes</h3>
              <div className="flex flex-wrap gap-1.5">
                {grant.themes.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium">{t}</span>
                ))}
              </div>
            </div>
          )}
          {grant.geographies && grant.geographies.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Geographies</h3>
              <div className="flex flex-wrap gap-1.5">
                {grant.geographies.map(g => (
                  <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">{g}</span>
                ))}
              </div>
            </div>
          )}
          {grant.notes && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 md:col-span-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{grant.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          {!grant.tasks || grant.tasks.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No tasks yet.</div>
          ) : (
            <div className="space-y-2">
              {grant.tasks.map(t => (
                <div key={t.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TASK_STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {t.status.replace(/_/g, ' ')}
                  </span>
                  <span className="flex-1 text-sm text-gray-800">{t.title}</span>
                  {t.due_date && (
                    <span className="text-xs text-gray-400 shrink-0">{formatDate(t.due_date)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'partners' && (
        <SuggestedPartners entityType="grant" entityId={id} />
      )}
    </div>
  );
}
