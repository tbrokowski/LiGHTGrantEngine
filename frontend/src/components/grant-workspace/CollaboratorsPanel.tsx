'use client';
import { useState, useEffect, useCallback } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Grant editors and org admins / grant leads can manage collaborators
  const myMember = members.find(m => m.user_id === user?.id);
  const isGrantEditor = myMember?.role === 'editor' || myMember?.role === 'owner';
  const canManage = isInstitutionAdmin(user) || user?.role === 'grant_lead' || isGrantEditor;

  const fetchMembers = useCallback(async () => {
    try {
      const res = await grants.listMembers(grantId);
      setMembers(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [grantId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await grants.inviteMember(grantId, { email: inviteEmail.trim(), role: inviteRole });
      setSuccess(`Invited ${inviteEmail.trim()}.`);
      setInviteEmail('');
      fetchMembers();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Failed to invite member.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string, email: string) {
    if (!confirm(`Remove ${email} from this grant?`)) return;
    try {
      await grants.removeMember(grantId, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch {
      alert('Failed to remove member.');
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading collaborators…</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900">Team & Collaborators</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          People with access to this grant. Institution members can see it automatically; external collaborators must be invited.
        </p>
      </div>

      {/* Invite form */}
      {canManage && (
        <form onSubmit={handleInvite} className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl">
          <p className="text-sm font-medium text-gray-700 mb-3">Invite a collaborator</p>
          <div className="flex gap-2">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition"
            >
              {inviting ? 'Inviting…' : 'Invite'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          {success && <p className="text-xs text-green-600 mt-2">{success}</p>}
        </form>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-8">
          No collaborators added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl"
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-semibold text-indigo-700 shrink-0">
                {initials(m.name, m.email)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {m.name && <span className="text-sm font-medium text-gray-900">{m.name}</span>}
                  <span className="text-sm text-gray-500 truncate">{m.email}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded border capitalize ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                    {m.role}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {m.status}
                  </span>
                  {!m.user_id && (
                    <span className="text-xs text-amber-600 italic">not yet registered</span>
                  )}
                </div>
              </div>

              {/* Remove */}
              {canManage && m.user_id !== user?.id && (
                <button
                  onClick={() => handleRemove(m.id, m.email)}
                  className="shrink-0 text-gray-400 hover:text-red-500 transition-colors p-1"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
