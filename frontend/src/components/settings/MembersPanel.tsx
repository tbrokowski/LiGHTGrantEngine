'use client';
import { useEffect, useState } from 'react';
import { organizations } from '@/lib/api';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  institution_role: string;
  created_at: string | null;
}

const ROLES = ['admin', 'grant_lead', 'operations_manager', 'reviewer', 'contributor', 'viewer'];

function RoleBadge({ role, institutionRole }: { role: string; institutionRole: string }) {
  const isAdmin = institutionRole === 'admin';
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium';
  if (isAdmin) return <span className={`${base} bg-purple-100 text-purple-700`}>Org Admin</span>;
  const labels: Record<string, string> = {
    grant_lead: 'Grant Lead',
    operations_manager: 'Ops Manager',
    reviewer: 'Reviewer',
    contributor: 'Contributor',
    viewer: 'Viewer',
    admin: 'Admin',
  };
  return <span className={`${base} bg-gray-100 text-gray-700`}>{labels[role] ?? role}</span>;
}

export function MembersPanel({ institutionId }: { institutionId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await organizations.members(institutionId);
      setMembers(res.data);
    } catch {
      setError('Failed to load members.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [institutionId]);

  async function handleRoleChange(userId: string, role: string) {
    setUpdatingId(userId);
    try {
      await organizations.updateMember(institutionId, userId, { role });
      setMembers(prev => prev.map(m => m.id === userId ? { ...m, role } : m));
    } catch {
      alert('Failed to update role.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRemove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the organization?`)) return;
    try {
      await organizations.removeMember(institutionId, userId);
      setMembers(prev => prev.filter(m => m.id !== userId));
    } catch {
      alert('Failed to remove member.');
    }
  }

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading members…</div>;
  if (error) return <div className="text-sm text-red-500 py-4">{error}</div>;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        Members ({members.length})
      </h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {members.map(m => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                <td className="px-4 py-3 text-gray-500">{m.email}</td>
                <td className="px-4 py-3">
                  {m.institution_role === 'admin' ? (
                    <RoleBadge role={m.role} institutionRole={m.institution_role} />
                  ) : (
                    <select
                      value={m.role}
                      disabled={updatingId === m.id}
                      onChange={e => handleRoleChange(m.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>
                          {r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  {m.institution_role !== 'admin' && (
                    <button
                      onClick={() => handleRemove(m.id, m.name)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">
                  No members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
