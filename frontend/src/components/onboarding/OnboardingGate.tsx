'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import OnboardingWizard from './OnboardingWizard';

function seenKey(userId: string | number) {
  return `onboarding_seen_${userId}`;
}

export default function OnboardingGate() {
  const { user, loading } = useAuth();
  // null = not yet determined, true = already seen, false = first time (show modal)
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) {
      setSeen(null);
      return;
    }
    const alreadySeen =
      user.onboarding_complete ||
      !!localStorage.getItem(seenKey(user.id));
    if (alreadySeen) {
      localStorage.setItem(seenKey(user.id), '1');
    }
    setSeen(alreadySeen);
  }, [user?.id, user?.onboarding_complete]);

  function handleClose() {
    if (user) {
      localStorage.setItem(seenKey(user.id), '1');
    }
    setSeen(true);
  }

  if (loading || !user || seen !== false) return null;

  return <OnboardingWizard onClose={handleClose} />;
}
