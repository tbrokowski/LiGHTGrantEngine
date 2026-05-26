'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import { setAuthSession } from '@/lib/auth-cookie';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface InviteInfo {
  email: string;
  role: string;
  institution_id: string;
  institution_name: string;
}

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API}/api/v1/auth/invite/${token}`)
      .then(res => setInfo(res.data))
      .catch(() => setError('This invite link is invalid or has expired.'))
      .finally(() => setValidating(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/api/v1/auth/accept-invite`, {
        token,
        name,
        password,
      });
      setAuthSession(res.data.access_token);
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Failed to accept invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (validating) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500 text-sm">Validating invite…</div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Invalid invite</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <Link href="/login" className="text-sm text-gray-900 font-medium underline underline-offset-2">
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
            You&apos;ve been invited<br />to join the team.
          </h1>
          <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
            Set up your account to start collaborating on grants with{' '}
            <span className="text-white font-medium">{info?.institution_name}</span>.
          </p>
        </div>
        <div className="text-gray-600 text-xs">
          Dynamic Grant Intelligence, Tracking &amp; Proposal Automation
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="text-gray-900 text-2xl font-semibold mb-1">Accept invitation</div>
            <p className="text-gray-500 text-sm">
              Joining <span className="font-medium text-gray-700">{info?.institution_name}</span> as{' '}
              <span className="font-medium text-gray-700">{info?.role}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email (pre-filled, read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
              <input
                type="email"
                value={info?.email || ''}
                readOnly
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>

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

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Create password</label>
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
              {loading ? 'Setting up account…' : 'Accept invitation & join'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="text-gray-600 underline underline-offset-2">
              Sign in instead
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
