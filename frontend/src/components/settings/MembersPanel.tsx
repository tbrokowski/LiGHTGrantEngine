'use client';
import { useEffect, useState } from 'react';
import { organizations } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  institution_role: string;
  module_permissions: Record<string, boolean>;
  created_at: string | null;
}

const USER_ROLES = [
  { value: 'grant_lead', label: 'Grant Lead' },
  { value: 'operations_manager', label: 'Ops Manager' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'viewer', label: 'Viewer' },
];

const MODULE_PERMISSIONS = [
  { key: 'can_view_grants', label: 'Grants' },
  { key: 'can_view_archive', label: 'Archive' },
  { key: 'can_view_partners', label: 'Partners' },
];

const DEFAULT_PERMS: Record<string, boolean> = {
  can_view_grants: false,
  can_view_archive: true,
  can_view_partners: true,
};

function PermToggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-1 ${
          value ? 'bg-gray-800' : 'bg-gray-300'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <span
          className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
            value ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-xs text-gray-600">{label}</span>
    </label>
  );
}

export function MembersPanel({ institutionId }: { institutionId: string }) {
  const { user: currentUser } = useAuth();
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

  async function patchMember(
    userId: string,
    patch: { role?: string; institution_role?: string; module_permissions?: Record<string, boolean> },
  ) {
    const member = members.find(m => m.id === userId);
    if (!member) return;
    setUpdatingId(userId);
    try {
      await organizations.updateMember(institutionId, userId, {
        role: patch.role ?? member.role,
        institution_role: patch.institution_role,
        module_permissions: patch.module_permissions,
      });
      setMembers(prev =>
        prev.map(m =>
          m.id === userId
            ? {
                ...m,
                role: patch.role ?? m.role,
                institution_role: patch.institution_role ?? m.institution_role,
                module_permissions: patch.module_permissions ?? m.module_permissions,
              }
            : m,
        ),
      );
    } catch {
      alert('Failed to update member.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    await patchMember(userId, { role });
  }

  async function handleAdminToggle(member: Member) {
    if (member.id === currentUser?.id) {
      alert('You cannot change your own admin status.');
      return;
    }
    const newInstRole = member.institution_role === 'admin' ? 'member' : 'admin';
    await patchMember(member.id, { institution_role: newInstRole });
  }

  async function handlePermToggle(member: Member, key: string, value: boolean) {
    const current = { ...DEFAULT_PERMS, ...(member.module_permissions || {}) };
    current[key] = value;
    await patchMember(member.id, { module_permissions: current });
  }

  async function handleRemove(userId: string, name: string) {
    if (userId === currentUser?.id) {
      alert('You cannot remove yourself from the organization.');
      return;
    }
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
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Members ({members.length})</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Org Admin</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Module Access</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {members.map(m => {
              const isAdmin = m.institution_role === 'admin';
              const isSelf = m.id === currentUser?.id;
              const perms = { ...DEFAULT_PERMS, ...(m.module_permissions || {}) };

              return (
                <tr key={m.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                    {m.name}
                    {isSelf && (
                      <span className="ml-1.5 text-xs text-gray-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{m.email}</td>

                  {/* Role selector */}
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                        Org Admin
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        disabled={updatingId === m.id}
                        onChange={e => handleRoleChange(m.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                      >
                        {USER_ROLES.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Org admin toggle */}
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={updatingId === m.id || isSelf}
                      onClick={() => handleAdminToggle(m)}
                      title={isSelf ? 'Cannot change your own admin status' : isAdmin ? 'Remove admin' : 'Make org admin'}
                      className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        isAdmin ? 'bg-purple-600' : 'bg-gray-300'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                          isAdmin ? 'translate-x-3' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Module permission toggles — hidden for org admins (they always have full access) */}
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <span className="text-xs text-gray-400">Full access</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {MODULE_PERMISSIONS.map(({ key, label }) => (
                          <PermToggle
                            key={key}
                            label={label}
                            value={perms[key] ?? false}
                            disabled={updatingId === m.id}
                            onChange={v => handlePermToggle(m, key, v)}
                          />
                        ))}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                  </td>

                  <td className="px-4 py-3">
                    {!isSelf && (
                      <button
                        onClick={() => handleRemove(m.id, m.name)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium whitespace-nowrap"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">
                  No members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Module Access controls which sections of the app a member can see. Org Admins always have full access.
      </p>
    </div>
  );
}
