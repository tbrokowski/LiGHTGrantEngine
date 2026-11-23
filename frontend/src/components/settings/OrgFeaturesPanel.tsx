'use client';
// Super-admin only: switch organization-level features on or off for the
// active organization. Today that's the Funders tab (on for LiGHT).
import { useEffect, useState } from 'react';
import { funders as fundersApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function OrgFeaturesPanel({ institutionId }: { institutionId: string }) {
  const { user, refresh } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fundersApi.getFeature(institutionId).then(r => setEnabled(!!r.data.enabled)).catch(() => setEnabled(null));
  }, [institutionId]);

  async function toggle() {
    if (enabled === null) return;
    setSaving(true);
    try {
      const r = await fundersApi.setFeature(institutionId, !enabled);
      setEnabled(!!r.data.enabled);
      await refresh(); // the sidebar reads the switch from /auth/me
    } finally { setSaving(false); }
  }

  return (
    <section className="max-w-2xl">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Organization features</h2>
      <p className="text-sm mt-1" style={{ color: 'var(--ink-muted)' }}>Only platform super-admins see this.</p>
      <div className="mt-3 flex items-center justify-between gap-4 py-3" style={{ borderTop: '1px solid var(--rule-subtle)', borderBottom: '1px solid var(--rule-subtle)' }}>
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>🐋 Funders tab</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Partners sorted into whale tiers, below Partners in the sidebar for {user?.institution_name ?? 'this organization'}.
            The first visit loads the team&apos;s starter list.
          </div>
        </div>
        <button type="button" role="switch" aria-checked={!!enabled} onClick={toggle} disabled={enabled === null || saving}
          className="relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50"
          style={{ background: enabled ? 'var(--accent-primary)' : 'var(--rule-strong)' }}>
          <span className="absolute top-0.5 w-5 h-5 rounded-full transition-all" style={{ left: enabled ? 18 : 2, background: 'var(--surface-base)', boxShadow: 'var(--shadow-panel)' }} />
          <span className="sr-only">Funders tab</span>
        </button>
      </div>
    </section>
  );
}
