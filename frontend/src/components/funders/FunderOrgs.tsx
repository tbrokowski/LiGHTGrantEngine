'use client';
// Organizations view: which foundations, family offices and networks the
// funders are tied to — e.g. the organizations behind the Dolphins.
import Link from 'next/link';
import { Building2, Globe } from 'lucide-react';
import { Avatar, card } from '@/components/crm/crmUi';
import { TIER_BY_KEY, TierPill, tierRank } from './tiers';
import { FunderRow, funderHref, health } from './types';

interface OrgBucket { key: string; name: string; id?: string | null; website?: string | null; people: FunderRow[] }

function bucket(rows: FunderRow[]): OrgBucket[] {
  const map = new Map<string, OrgBucket>();
  for (const f of rows) {
    const name = (f.org_name || '').trim();
    const key = f.organization_id || (name ? name.toLowerCase() : '');
    const b = map.get(key) ?? { key, name: name || 'No organization', id: f.organization_id, website: f.org_website, people: [] };
    b.people.push(f);
    map.set(key, b);
  }
  const list = Array.from(map.values());
  for (const b of list) b.people.sort((a, z) => tierRank(a.funder_tier) - tierRank(z.funder_tier) || a.name.localeCompare(z.name));
  // Most-connected organizations first; people without one go last.
  return list.sort((a, z) => (a.key === '' ? 1 : 0) - (z.key === '' ? 1 : 0) || z.people.length - a.people.length || a.name.localeCompare(z.name));
}

function host(u?: string | null) {
  if (!u) return null;
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}

export default function FunderOrgs({ rows }: { rows: FunderRow[] }) {
  const orgs = bucket(rows);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
      {orgs.map(o => {
        const tiers = Array.from(new Set(o.people.map(p => p.funder_tier))).sort((a, b) => tierRank(a) - tierRank(b));
        const h = host(o.website);
        return (
          <section key={o.key || 'none'} className="overflow-hidden" style={card}>
            <header className="flex items-start gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
              <span className="w-9 h-9 shrink-0 rounded-[var(--radius-md)] flex items-center justify-center" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                <Building2 className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                {o.id
                  ? <Link href={`/partners/organizations/${o.id}`} className="block text-sm font-semibold truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{o.name}</Link>
                  : <div className="text-sm font-semibold truncate" style={{ color: o.key ? 'var(--ink-primary)' : 'var(--ink-muted)' }}>{o.name}</div>}
                <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  <span><span className="mono-data">{o.people.length}</span> {o.people.length === 1 ? 'person' : 'people'}</span>
                  {h && (
                    <a href={o.website!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline truncate">
                      <Globe className="w-3 h-3" />{h}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex -space-x-1 shrink-0" aria-label={`Tiers: ${tiers.map(k => TIER_BY_KEY[k]?.label).join(', ')}`}>
                {tiers.map(k => {
                  const t = TIER_BY_KEY[k];
                  return (
                    <span key={k} title={t.label} className="w-6 h-6 rounded-full flex items-center justify-center text-[13px]"
                      style={{ background: `${t.color}1F`, boxShadow: '0 0 0 2px var(--surface-base)' }}>
                      {t.emoji}
                    </span>
                  );
                })}
              </div>
            </header>
            <ul>
              {o.people.map((f, i) => {
                const hl = health(f.last_touch);
                return (
                  <li key={f.id} className="flex items-center gap-2.5 px-4 py-2" style={{ borderTop: i ? '1px solid var(--rule-subtle)' : undefined }}>
                    <span className="relative shrink-0">
                      <Avatar name={f.name} size={26} />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full" title={hl.label} style={{ background: hl.color, boxShadow: '0 0 0 2px var(--surface-base)' }} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link href={funderHref(f.id)} className="block text-[13px] font-medium truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{f.name}</Link>
                      {f.title && <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{f.title}</div>}
                    </div>
                    <TierPill tierKey={f.funder_tier} size="sm" />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
