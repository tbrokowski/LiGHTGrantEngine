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
        <div className="flex h-screen bg-gray-50 overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <TopBar />
            <EmailVerificationBanner />
            <UsageLimitWarning />
            <OnboardingGate />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
      </PdfViewerProvider>
    </AuthProvider>
  );
}
