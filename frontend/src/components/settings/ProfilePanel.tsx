'use client';
import { useState, useEffect } from 'react';
import { auth, users } from '@/lib/api';
import { clearAuthSession } from '@/lib/auth-cookie';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function ProfilePanel() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    auth.me().then(res => {
      setUser(res.data);
      setName(res.data.name ?? '');
      setEmail(res.data.email ?? '');
    }).catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSuccess('');
    setError('');
    const updates: Record<string, string> = {};
    if (name !== user.name) updates.name = name;
    if (email !== user.email) updates.email = email;
    if (newPassword) {
      if (!currentPassword) {
        setError('Enter your current password to set a new one.');
        setSaving(false);
        return;
      }
      updates.password = newPassword;
    }
    if (Object.keys(updates).length === 0) {
      setError('No changes to save.');
      setSaving(false);
      return;
    }
    try {
      await users.update(user.id, updates);
      setSuccess('Profile updated.');
      setCurrentPassword('');
      setNewPassword('');
      setUser(prev => prev ? { ...prev, ...updates } : prev);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  }

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Admin',
    grant_lead: 'Grant Lead',
    operations_manager: 'Operations Manager',
    reviewer: 'Reviewer',
    contributor: 'Contributor',
    viewer: 'Viewer',
  };

  return (
    <div className="max-w-md">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">My Profile</h3>
      {user && (
        <div className="flex items-center gap-3 mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold text-sm">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900">{user.name}</div>
            <div className="text-xs text-gray-500">
              {ROLE_LABELS[user.role] ?? user.role}
            </div>
          </div>
        </div>
      )}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Full name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Email address</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>

        <div className="pt-2 border-t border-gray-100">
          <div className="text-xs font-medium text-gray-700 mb-3">Change password</div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="pt-4 mt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={() => { clearAuthSession(); window.location.href = '/login'; }}
          className="w-full py-2.5 border border-gray-300 hover:border-gray-400 text-gray-700 text-sm font-medium rounded-lg transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
