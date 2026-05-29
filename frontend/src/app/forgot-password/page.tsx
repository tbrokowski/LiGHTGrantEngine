'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/api';

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.forgotPassword(email);
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex w-1/2 bg-gray-900 flex-col justify-between p-12">
        <div>
          <div className="text-white text-lg font-bold tracking-tight">LiGHT</div>
          <div className="text-gray-400 text-sm mt-0.5">Grant Engine</div>
        </div>
        <div>
          <h1 className="text-4xl font-semibold text-white leading-tight mb-4">
            Intelligent grant<br />management for<br />research teams.
          </h1>
          <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
            Discover, evaluate, and write competitive grants — with AI-assisted scoring,
            proposal editing, and partner relationship management in one platform.
          </p>
        </div>
        <div className="text-gray-600 text-xs">
          Dynamic Grant Intelligence, Tracking &amp; Proposal Automation
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-sm">
          {submitted ? (
            <div>
              <div className="mb-6">
                <div className="text-gray-900 text-2xl font-semibold mb-1">Check your email</div>
                <div className="text-gray-500 text-sm">
                  If <span className="font-medium text-gray-700">{email}</span> is registered,
                  you&apos;ll receive a password reset link shortly.
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                Didn&apos;t receive an email? Check your spam folder or{' '}
                <button
                  type="button"
                  onClick={() => { setSubmitted(false); setEmail(''); }}
                  className="text-gray-900 font-medium underline underline-offset-2"
                >
                  try again
                </button>
                .
              </p>
              <Link
                href="/login"
                className="block w-full py-2.5 px-4 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition text-center focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <div>
              <div className="mb-10">
                <div className="text-gray-900 text-2xl font-semibold mb-1">Forgot password?</div>
                <div className="text-gray-500 text-sm">
                  Enter your email and we&apos;ll send you a reset link.{' '}
                  <Link href="/login" className="text-gray-900 font-medium underline underline-offset-2">
                    Back to sign in
                  </Link>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Email address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition"
                    placeholder="you@institution.edu"
                    autoComplete="email"
                    autoFocus
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
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
