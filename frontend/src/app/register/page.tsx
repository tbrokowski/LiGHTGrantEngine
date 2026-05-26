'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/api';
import { setAuthSession } from '@/lib/auth-cookie';

type InstitutionMode = 'none' | 'join' | 'create';

interface Institution {
  id: string;
  name: string;
  domain: string | null;
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<InstitutionMode>('none');
  const [instSearch, setInstSearch] = useState('');
  const [instResults, setInstResults] = useState<Institution[]>([]);
  const [selectedInst, setSelectedInst] = useState<Institution | null>(null);
  const [newInstName, setNewInstName] = useState('');
  const [newInstDomain, setNewInstDomain] = useState('');
  const [joinMessage, setJoinMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('access_token')) {
      router.replace('/dashboard');
    }
  }, [router]);

  const searchInstitutions = useCallback(async (q: string) => {
    if (!q.trim()) { setInstResults([]); return; }
    try {
      const res = await auth.searchInstitutions(q);
      setInstResults(res.data);
    } catch {
      setInstResults([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchInstitutions(instSearch), 300);
    return () => clearTimeout(t);
  }, [instSearch, searchInstitutions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (mode === 'join' && !selectedInst) {
      setError('Please select an institution to join.');
      return;
    }
    if (mode === 'create' && !newInstName.trim()) {
      setError('Please enter a name for your institution.');
      return;
    }

    setLoading(true);
    try {
      const payload: Parameters<typeof auth.register>[0] = { name, email, password };
      if (mode === 'join' && selectedInst) {
        payload.institution_id = selectedInst.id;
        if (joinMessage.trim()) payload.join_message = joinMessage;
      } else if (mode === 'create') {
        payload.institution_name = newInstName;
        if (newInstDomain.trim()) payload.institution_domain = newInstDomain;
      }
      const res = await auth.register(payload);
      setAuthSession(res.data.access_token);
      if (res.data.account_status === 'pending_approval') {
        setPendingApproval(true);
      } else {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Request submitted</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              Your request to join <strong>{selectedInst?.name}</strong> has been sent to the organization admin for approval.
              You&apos;ll receive an email once your request is reviewed.
            </p>
          </div>
          <p className="text-xs text-gray-400">
            You can close this page. Check your email for updates.
          </p>
          <Link href="/login" className="inline-block text-sm text-gray-900 font-medium underline underline-offset-2">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-gray-900 flex-col justify-between p-12">
        <div>
          <div className="text-white text-lg font-bold tracking-tight">LiGHT</div>
          <div className="text-gray-400 text-sm mt-0.5">Grant Engine</div>
        </div>
        <div>
          <h1 className="text-4xl font-semibold text-white leading-tight mb-4">
            Join your team<br />on the platform.
          </h1>
          <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
            Create an account and connect to your institution to start collaborating
            on grants with your team.
          </p>
        </div>
        <div className="text-gray-600 text-xs">
          Dynamic Grant Intelligence, Tracking &amp; Proposal Automation
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 overflow-y-auto">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="text-gray-900 text-2xl font-semibold mb-1">Create account</div>
            <div className="text-gray-500 text-sm">
              Already have an account?{' '}
              <Link href="/login" className="text-gray-900 font-medium underline underline-offset-2">
                Sign in
              </Link>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full name</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition"
                placeholder="Jane Smith"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition"
                placeholder="you@institution.edu"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            {/* Institution */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Institution</label>
              <div className="space-y-2">
                {(['none', 'join', 'create'] as InstitutionMode[]).map(m => (
                  <label key={m} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="instMode"
                      checked={mode === m}
                      onChange={() => { setMode(m); setSelectedInst(null); setInstSearch(''); }}
                      className="accent-gray-900"
                    />
                    <span className="text-sm text-gray-700">
                      {m === 'none' && 'No institution for now'}
                      {m === 'join' && 'Join an existing institution'}
                      {m === 'create' && 'Create a new institution'}
                    </span>
                  </label>
                ))}
              </div>
              {mode === 'none' && (
                <p className="text-xs text-gray-500 mt-2">
                  A personal workspace will be created for you with admin access. If you join a team later via invite, you&apos;ll join as a regular member.
                </p>
              )}
            </div>

            {/* Join institution search */}
            {mode === 'join' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={selectedInst ? selectedInst.name : instSearch}
                  onChange={e => { setInstSearch(e.target.value); setSelectedInst(null); }}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition"
                  placeholder="Search institution name…"
                />
                {!selectedInst && instResults.length > 0 && (
                  <div className="border border-gray-200 rounded-lg bg-white shadow-sm max-h-40 overflow-y-auto">
                    {instResults.map(inst => (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => { setSelectedInst(inst); setInstSearch(inst.name); setInstResults([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="font-medium">{inst.name}</span>
                        {inst.domain && <span className="text-gray-400 ml-2 text-xs">{inst.domain}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {selectedInst && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-sm">
                    <span className="text-indigo-800 font-medium">{selectedInst.name}</span>
                    <button
                      type="button"
                      onClick={() => { setSelectedInst(null); setInstSearch(''); }}
                      className="ml-auto text-indigo-400 hover:text-indigo-600"
                    >
                      ×
                    </button>
                  </div>
                )}
                {selectedInst && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Message for admin (optional)</label>
                    <textarea
                      value={joinMessage}
                      onChange={e => setJoinMessage(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                      placeholder="Briefly describe your role or why you're joining…"
                    />
                  </div>
                )}
                {selectedInst && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    Your account will be created but access requires admin approval.
                  </p>
                )}
              </div>
            )}

            {/* Create institution */}
            {mode === 'create' && (
              <div className="space-y-2 p-3.5 border border-gray-200 rounded-lg bg-gray-50">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Institution name *</label>
                  <input
                    type="text"
                    value={newInstName}
                    onChange={e => setNewInstName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                    placeholder="e.g. EPFL, Stanford University"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email domain (optional)</label>
                  <input
                    type="text"
                    value={newInstDomain}
                    onChange={e => setNewInstDomain(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                    placeholder="e.g. epfl.ch"
                  />
                </div>
                <p className="text-xs text-gray-500">You will become the admin of this institution.</p>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
