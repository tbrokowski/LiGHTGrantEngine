'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const token = searchParams.get('token');
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('No verification token provided.');
      return;
    }
    auth.verifyEmail(token)
      .then(async () => {
        await refresh();
        setState('success');
        setMessage('Your email has been verified. Redirecting...');
        setTimeout(() => router.push('/dashboard'), 2000);
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail;
        setState('error');
        setMessage(typeof detail === 'string' ? detail : 'Verification failed. The link may have expired.');
      });
  }, [token, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-10 max-w-sm w-full text-center">
        {state === 'loading' && (
          <>
            <div className="w-10 h-10 rounded-full border-2 border-gray-200 border-t-gray-600 animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-600">Verifying your email…</p>
          </>
        )}
        {state === 'success' && (
          <>
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-base font-semibold text-gray-900 mb-2">Email verified</h1>
            <p className="text-sm text-gray-500">{message}</p>
          </>
        )}
        {state === 'error' && (
          <>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-base font-semibold text-gray-900 mb-2">Verification failed</h1>
            <p className="text-sm text-gray-500 mb-4">{message}</p>
            <button
              onClick={() => router.push('/login')}
              className="text-sm font-medium text-gray-700 hover:text-gray-900 underline underline-offset-2"
            >
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-gray-600 animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
