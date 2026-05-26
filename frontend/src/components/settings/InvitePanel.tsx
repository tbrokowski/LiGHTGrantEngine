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

export function InvitePanel({ institutionId }: { institutionId: string }) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('contributor');
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
      await organizations.invite(institutionId, { email: inviteEmail, role: inviteRole });
      setInviteSuccess(`Invitation sent to ${inviteEmail}.`);
      setInviteEmail('');
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
      setAccessCode(res.data.access_code);
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
        <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="colleague@institution.edu"
            className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
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
