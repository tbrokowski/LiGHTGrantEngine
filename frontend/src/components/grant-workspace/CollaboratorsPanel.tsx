'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { grants } from '@/lib/api';
import { useAuth, isInstitutionAdmin } from '@/lib/auth';

interface GrantMember {
  id: string;
  grant_id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  role: string;
  status: string;
  invited_by_id: string | null;
  created_at: string;
  is_org_member?: boolean;
}

interface AssignableMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  grantId: string;
}

function initials(name: string | null, email: string): string {
  if (name) {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
  return email[0].toUpperCase();
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-50 text-purple-700 border-purple-200',
  editor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  viewer: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_COLORS: Record<string, string> = {
  accepted: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
};

export default function CollaboratorsPanel({ grantId }: Props) {
  const { user } = useAuth();
  const [members, setMembers] = useState<GrantMember[]>([]);
  const [assignable, setAssignable] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-from-org state
  const [orgSearch, setOrgSearch] = useState('');
  const [orgRole, setOrgRole] = useState('editor');
  const [addingUserId, setAddingUserId] = useState<string | null>(null);

  // Invite-guest state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const myMember = members.find(m => m.user_id === user?.id);
  const isGrantEditor = myMember?.role === 'editor' || myMember?.role === 'owner';
  const canManage = isInstitutionAdmin(user) || user?.role === 'grant_lead' || isGrantEditor;

  const fetchMembers = useCallback(async () => {
    try {
      const res = await grants.listMembers(grantId);
      setMembers(res.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [grantId]);

  const fetchAssignable = useCallback(async () => {
    try {
      const res = await grants.assignableMembers(grantId);
      setAssignable(res.data);
    } catch { setAssignable([]); }
  }, [grantId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);
  useEffect(() => { if (canManage) fetchAssignable(); }, [canManage, fetchAssignable]);

  const filteredAssignable = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    const list = q
      ? assignable.filter(m => m.name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      : assignable;
    return list.slice(0, 8);
  }, [assignable, orgSearch]);

  async function addFromOrg(m: AssignableMember) {
    setError(''); setSuccess('');
    setAddingUserId(m.id);
    try {
      await grants.inviteMember(grantId, { user_id: m.id, role: orgRole });
      setSuccess(`Added ${m.name || m.email}.`);
      setOrgSearch('');
      await Promise.all([fetchMembers(), fetchAssignable()]);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to add member.');
    } finally {
      setAddingUserId(null);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await grants.inviteMember(grantId, { email: inviteEmail.trim(), role: inviteRole });
      setSuccess(`Invited ${inviteEmail.trim()} as a guest on this grant.`);
      setInviteEmail('');
      fetchMembers();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to invite collaborator.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string, email: string) {
    if (!confirm(`Remove ${email} from this grant? (This only removes their access to this grant.)`)) return;
    try {
      await grants.removeMember(grantId, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
      fetchAssignable();
    } catch {
      alert('Failed to remove member.');
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading collaborators…</div>;
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Team &amp; Collaborators</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Add people from your organization, or invite an outside guest by email — guests get access to this grant only and keep their own account.
        </p>
      </div>

      {canManage && (
        <div className="space-y-3 mb-6">
          {/* Add from organization */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Add from organization</p>
              <select
                value={orgRole}
                onChange={e => setOrgRole(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <input
              value={orgSearch}
              onChange={e => setOrgSearch(e.target.value)}
              placeholder="Search organization members…"
              className={inputCls}
            />
            {orgSearch.trim() && (
              <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white overflow-hidden">
                {filteredAssignable.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No matching members available.</p>
                ) : filteredAssignable.map(m => (
                  <button
                    key={m.id}
                    onClick={() => addFromOrg(m)}
                    disabled={addingUserId === m.id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  >
                    <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700 shrink-0">
                      {initials(m.name, m.email)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm text-gray-800">{m.name}</span>
                      <span className="text-xs text-gray-400 ml-1.5">{m.email}</span>
                    </span>
                    <span className="text-xs text-indigo-600 font-medium shrink-0">
                      {addingUserId === m.id ? 'Adding…' : '+ Add'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!orgSearch.trim() && assignable.length === 0 && (
              <p className="text-xs text-gray-400 mt-2">Everyone in your organization is already on this grant.</p>
            )}
          </div>

          {/* Invite an outside guest by email */}
          <form onSubmit={handleInvite} className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
            <p className="text-sm font-medium text-gray-700 mb-2">Invite a guest by email</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="collaborator@example.com"
                className={inputCls}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition shrink-0"
              >
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Guests get access to this grant only. They don’t join your organization; they’ll get access as soon as they sign up.
            </p>
          </form>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
        </div>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-8">No collaborators added yet.</div>
      ) : (
        <div className="space-y-2">
          {members.map(m => {
            const isGuest = !m.is_org_member;
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-semibold text-indigo-700 shrink-0">
                  {initials(m.name, m.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {m.name && <span className="text-sm font-medium text-gray-900">{m.name}</span>}
                    <span className="text-sm text-gray-500 truncate">{m.email}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded border capitalize ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {m.role}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isGuest ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                      {isGuest ? 'Guest' : 'Org member'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {m.status}
                    </span>
                    {isGuest && !m.user_id && (
                      <span className="text-xs text-amber-600 italic">not yet registered</span>
                    )}
                  </div>
                </div>
                {canManage && m.user_id !== user?.id && m.role !== 'owner' && (
                  <button
                    onClick={() => handleRemove(m.id, m.email)}
                    className="shrink-0 text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Remove from grant"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
