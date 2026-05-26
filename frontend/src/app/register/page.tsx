'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/api';

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      } else if (mode === 'create') {
        payload.institution_name = newInstName;
        if (newInstDomain.trim()) payload.institution_domain = newInstDomain;
      }
      const res = await auth.register(payload);
      localStorage.setItem('access_token', res.data.access_token);
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
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
