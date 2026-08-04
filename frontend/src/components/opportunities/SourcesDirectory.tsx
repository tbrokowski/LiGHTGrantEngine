'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { organizations } from '@/lib/api';

interface OrgSource {
  id: string;
  name: string;
  url: string | null;
  source_type: string;
  category: string | null;
  status: string;
  is_high_priority: boolean;
  is_enabled: boolean;
  opportunity_count: number;
}

const TYPE_LABELS: Record<string, string> = {
  ai_scraper: 'AI scraper',
  agentic: 'Agentic',
  html_static: 'HTML',
  html_dynamic: 'HTML (JS)',
  rss: 'RSS',
  openreview: 'OpenReview',
  grants_gov: 'Grants.gov',
  eu_funding: 'EU Funding',
};

export default function SourcesDirectory({ institutionId }: { institutionId: string | null }) {
  const [sources, setSources] = useState<OrgSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!institutionId) { setLoading(false); return; }
    try {
      const res = await organizations.listOrgSources(institutionId);
      setSources(res.data);
    } catch { setSources([]); } finally { setLoading(false); }
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sources
      .filter(s => s.is_enabled && (!term || s.name.toLowerCase().includes(term) || (s.category ?? '').toLowerCase().includes(term)))
      .sort((a, b) => b.opportunity_count - a.opportunity_count || a.name.localeCompare(b.name));
  }, [sources, q]);

  const totalOpps = useMemo(() => sources.reduce((n, s) => n + (s.opportunity_count || 0), 0), [sources]);

  return (
    <div style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)' }}>
      <div className="px-5 py-3.5 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Sources</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            Where your opportunities come from — {sources.filter(s => s.is_enabled).length} active, {totalOpps} opportunities. Click a source to visit it.
          </p>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search sources…"
          className="px-3 py-1.5 text-sm"
          style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', color: 'var(--ink-primary)', outline: 'none', width: 200 }}
        />
      </div>

      {loading ? (
        <div className="px-5 py-16 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className="px-5 py-16 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>No sources found.</div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--rule-subtle)' }}>
          {visible.map(s => {
            const host = s.url ? s.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
            const Inner = (
              <div className="px-5 py-3 flex items-center gap-3 group" style={{ borderColor: 'var(--rule-subtle)' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: s.url ? 'var(--accent-primary)' : 'var(--ink-primary)' }}>
                      {s.name}
                    </span>
                    {s.is_high_priority && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)' }}>Priority</span>
                    )}
                    {host && <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>· {host.slice(0, 48)} ↗</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                      {TYPE_LABELS[s.source_type] ?? s.source_type}
                    </span>
                    {s.category && <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>{s.category}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="mono-data text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>{s.opportunity_count}</div>
                  <div className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>opps</div>
                </div>
              </div>
            );
            return s.url ? (
              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="block hover:bg-[var(--selection-bg)] transition-colors">
                {Inner}
              </a>
            ) : (
              <div key={s.id}>{Inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
