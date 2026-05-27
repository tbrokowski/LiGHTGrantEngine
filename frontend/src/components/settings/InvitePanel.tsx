'use client';
import { useState } from 'react';
import { organizations } from '@/lib/api';

const ROLES = [
  { value: 'grant_lead', label: 'Grant Lead' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'viewer', label: 'Viewer' },
];

const MODULE_PERMISSIONS = [
  {
    key: 'can_view_grants',
    label: 'Access all Grants',
    description: 'Can see every grant in the organization portfolio',
    default: false,
  },
  {
    key: 'can_view_archive',
    label: 'Access Archive',
    description: 'Can browse the grant archive',
    default: true,
  },
  {
    key: 'can_view_partners',
    label: 'Access Partners',
    description: 'Can view and manage partner contacts',
    default: true,
  },
];

export function InvitePanel({ institutionId }: { institutionId: string }) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('contributor');
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>({
    can_view_grants: false,
    can_view_archive: true,
    can_view_partners: true,
  });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteError, setInviteError] = useState('');

  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteSuccess('');
    setInviteError('');
    try {
      await organizations.invite(institutionId, {
        email: inviteEmail,
        role: isOrgAdmin ? 'grant_lead' : inviteRole,
        institution_role: isOrgAdmin ? 'admin' : 'member',
        module_permissions: isOrgAdmin ? {} : perms,
      });
      setInviteSuccess(`Invitation sent to ${inviteEmail}.`);
      setInviteEmail('');
      setIsOrgAdmin(false);
      setInviteRole('contributor');
      setPerms({ can_view_grants: false, can_view_archive: true, can_view_partners: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setInviteError(msg || 'Failed to send invite.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function generateCode() {
    setCodeLoading(true);
    try {
      const res = await organizations.generateAccessCode(institutionId);
      setAccessCode(res.data.code);
    } catch {
      alert('Failed to generate access code.');
    } finally {
      setCodeLoading(false);
    }
  }

  function copyCode() {
    if (!accessCode) return;
    navigator.clipboard.writeText(accessCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      {/* Email invite */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Invite by email</h3>
        <p className="text-xs text-gray-500 mb-4">
          Send a personalized invite link. The recipient can register or sign in to join directly.
        </p>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@institution.edu"
              className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {!isOrgAdmin && (
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Org admin toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={isOrgAdmin}
              onClick={() => setIsOrgAdmin(v => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-1 ${
                isOrgAdmin ? 'bg-purple-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                  isOrgAdmin ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-gray-700 font-medium">
              Invite as Organization Admin
            </span>
          </label>

          {isOrgAdmin && (
            <p className="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
              This person will have full access to all grants, archive, partners, and organization settings.
            </p>
          )}

          {/* Module permissions (only shown when not inviting as admin) */}
          {!isOrgAdmin && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <p className="text-xs font-medium text-gray-700 mb-1">Module Access</p>
              {MODULE_PERMISSIONS.map(({ key, label, description, default: def }) => {
                const checked = perms[key] ?? def;
                return (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      onClick={() => setPerms(p => ({ ...p, [key]: !checked }))}
                      className={`mt-0.5 relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                        checked ? 'bg-gray-800' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                          checked ? 'translate-x-3' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <p className="text-sm text-gray-800 font-medium leading-none">{label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <button
            type="submit"
            disabled={inviteLoading}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition"
          >
            {inviteLoading ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        {inviteSuccess && (
          <p className="mt-2 text-sm text-green-600">{inviteSuccess}</p>
        )}
        {inviteError && (
          <p className="mt-2 text-sm text-red-600">{inviteError}</p>
        )}
      </div>

      {/* Access code */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Access code</h3>
        <p className="text-xs text-gray-500 mb-4">
          Generate a 6-character code valid for 72 hours. Anyone with this code can join the organization directly.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {accessCode ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg border border-gray-200">
                <span className="font-mono text-lg font-bold tracking-widest text-gray-900">
                  {accessCode}
                </span>
              </div>
              <button
                onClick={copyCode}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={generateCode}
                disabled={codeLoading}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
              >
                Regenerate
              </button>
            </>
          ) : (
            <button
              onClick={generateCode}
              disabled={codeLoading}
              className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition"
            >
              {codeLoading ? 'Generating…' : 'Generate access code'}
            </button>
          )}
        </div>
        {accessCode && (
          <p className="mt-2 text-xs text-amber-600">
            This code expires in 72 hours. Share it only with trusted people.
          </p>
        )}
      </div>
    </div>
  );
}
