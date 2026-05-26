'use client';
import { useState, useEffect, useCallback } from 'react';
import { grants } from '@/lib/api';

interface Milestone {
  id: string;
  title: string;
  target_date: string | null;
  status: string;
  work_package: string | null;
}

interface WorkPackageGroup {
  name: string;
  milestones: Milestone[];
}

interface Props {
  grantId: string;
}

const STATUS_STYLES: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  at_risk: 'bg-amber-100 text-amber-700',
  complete: 'bg-emerald-100 text-emerald-700',
  missed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

function formatDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return d; }
}

export default function WorkPackagePanel({ grantId }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignWp, setAssignWp] = useState('');

  const fetchMilestones = useCallback(() => {
    grants.listMilestones(grantId)
      .then(r => setMilestones(r.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grantId]);

  useEffect(() => { fetchMilestones(); }, [fetchMilestones]);

  const workPackages = new Set(milestones.map(m => m.work_package).filter(Boolean) as string[]);
  const groups: WorkPackageGroup[] = [
    ...Array.from(workPackages).map(name => ({
      name,
      milestones: milestones.filter(m => m.work_package === name),
    })),
    {
      name: 'Unassigned',
      milestones: milestones.filter(m => !m.work_package),
    },
  ].filter(g => g.milestones.length > 0);

  async function handleAssign(milestoneId: string, wpName: string) {
    try {
      await grants.updateMilestone(grantId, milestoneId, { work_package: wpName.trim() || null });
      fetchMilestones();
    } catch {
      alert('Failed to assign work package.');
    }
    setAssigning(null);
    setAssignWp('');
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Work Packages</h3>
        <p className="text-sm text-gray-400">Loading milestones…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Work Packages</h3>
          <p className="text-xs text-gray-400 mt-0.5">Group milestones into work packages for Gantt grouping.</p>
        </div>
      </div>

      {groups.map(group => (
        <div key={group.name} className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">{group.name}</span>
            <span className="text-xs text-gray-400">{group.milestones.length} milestone{group.milestones.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {group.milestones.map(m => (
              <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{m.title}</p>
                  {m.target_date && (
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(m.target_date)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[m.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {m.status}
                  </span>
                  {assigning === m.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={assignWp}
                        onChange={e => setAssignWp(e.target.value)}
                        placeholder="WP name (blank to remove)"
                        className="text-xs border border-gray-200 rounded px-2 py-1 w-36 focus:outline-none focus:ring-1 focus:ring-gray-300"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleAssign(m.id, assignWp);
                          if (e.key === 'Escape') { setAssigning(null); setAssignWp(''); }
                        }}
                      />
                      <button
                        onClick={() => handleAssign(m.id, assignWp)}
                        className="text-xs text-emerald-600 hover:text-emerald-800 px-1"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => { setAssigning(null); setAssignWp(''); }}
                        className="text-xs text-gray-400 hover:text-gray-600 px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAssigning(m.id); setAssignWp(m.work_package ?? ''); }}
                      className="text-xs text-gray-300 hover:text-gray-600 transition-colors"
                      title="Assign to work package"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {milestones.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">
          No milestones yet. Add milestones from the Tasks tab.
        </div>
      )}
    </div>
  );
}
