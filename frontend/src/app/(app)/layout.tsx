import { Toaster } from 'sonner';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import EmailVerificationBanner from '@/components/auth/EmailVerificationBanner';
import OnboardingGate from '@/components/onboarding/OnboardingGate';
import UsageLimitWarning from '@/components/ai/UsageLimitWarning';
import { AuthProvider } from '@/lib/auth';
import { PdfViewerProvider } from '@/contexts/PdfViewerContext';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PdfViewerProvider>
        <div className="flex h-screen overflow-hidden" style={{ background: 'var(--surface-chrome)' }}>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <TopBar />
            <EmailVerificationBanner />
            <UsageLimitWarning />
            <OnboardingGate />
            <main className="flex-1 overflow-hidden" style={{ padding: '0 12px 12px' }}>
              <div
                className="h-full overflow-hidden"
                style={{
                  background: 'var(--surface-base)',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--rule-subtle)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}
              >
                {children}
              </div>
            </main>
          </div>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
      </PdfViewerProvider>
    </AuthProvider>
  );
}
