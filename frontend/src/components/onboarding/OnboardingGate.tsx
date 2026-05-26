'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import OnboardingWizard from './OnboardingWizard';

export default function OnboardingGate() {
  const { user, loading } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (loading || !user || user.onboarding_complete || dismissed) return null;

  return <OnboardingWizard onClose={() => setDismissed(true)} />;
}
