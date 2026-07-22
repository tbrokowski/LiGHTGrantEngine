'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import FunderLogo from './FunderLogo';
import OpportunityActions, { type OpportunityActionHandlers } from './OpportunityActions';
import OpportunityTypeBadge from './OpportunityTypeBadge';
import { TIER_ACCENT } from './OpportunityRow';
import { formatDate, type Opportunity } from './types';

type GroupMode = 'type' | 'funderOrg' | 'funderGroup';

const GROUP_STORAGE_KEY = 'shortlist_group_mode';

interface Props extends OpportunityActionHandlers {
  items: Opportunity[];
  mode: 'shortlist' | 'org-shortlist';
  priorityFunderGroups?: { name: string; funders: string[] }[];
  funderOrgs?: { id: string; name: string }[];
  onNavigate?: (id: string) => void;
}

interface Row {
  label: string;
  items: Opportunity[];
}

function groupByType(items: Opportunity[]): Row[] {
  const map = new Map<string, Opportunity[]>();
  for (const o of items) {
    const key = o.opportunity_type ?? 'other';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, opps]) => ({ label: key.replace(/_/g, ' '), items: opps }));
}

function groupByFunderOrg(items: Opportunity[], funderOrgs: { id: string; name: string }[]): Row[] {
  const nameById = new Map(funderOrgs.map(f => [f.id, f.name]));
  const map = new Map<string, Opportunity[]>();
  const unassigned: Opportunity[] = [];
  for (const o of items) {
    if (!o.funder_org_id) { unassigned.push(o); continue; }
    const label = nameById.get(o.funder_org_id) ?? 'Unknown';
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(o);
  }
  const rows = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, opps]) => ({ label, items: opps }));
  if (unassigned.length > 0) rows.push({ label: 'Unassigned', items: unassigned });
  return rows;
}

function groupByFunderGroup(items: Opportunity[], groups: { name: string; funders: string[] }[]): Row[] {
  const rows: Row[] = [];
  const matched = new Set<string>();
  for (const group of groups) {
    const needles = group.funders.map(f => f.toLowerCase());
    const inGroup = items.filter(o => {
      const funder = (o.funder ?? '').toLowerCase();
      return funder && needles.some(n => funder.includes(n));
    });
    if (inGroup.length > 0) {
      rows.push({ label: group.name, items: inGroup });
      inGroup.forEach(o => matched.add(o.id));
    }
  }
  const other = items.filter(o => !matched.has(o.id));
  if (other.length > 0) rows.push({ label: 'Other', items: other });
  return rows.sort((a, b) => b.items.length - a.items.length);
}

function Card({ opp, mode, onNavigate, ...handlers }: { opp: Opportunity; mode: 'shortlist' | 'org-shortlist' } & OpportunityActionHandlers & { onNavigate?: (id: string) => void }) {
  const tierAccent = TIER_ACCENT[opp.priority ?? ''] ?? 'transparent';
  return (
    <div
      className="flex-shrink-0 w-60 rounded-lg overflow-hidden flex flex-col"
      style={{ border: '1px solid var(--rule-subtle)', borderLeft: `3px solid ${tierAccent}`, background: 'var(--surface-raised)' }}
    >
      <Link href={`/opportunities/${opp.id}`} className="block p-3 flex-1 min-w-0" onClick={() => onNavigate?.(opp.id)}>
        <div className="flex items-start gap-1.5 mb-1">
          {!opp.is_read && (
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent-primary)' }} title="Unread" />
          )}
          <span className="text-sm leading-snug line-clamp-2" style={{ color: 'var(--ink-primary)', fontWeight: 500 }}>
            {opp.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
          <FunderLogo url={opp.funder_logo_url} name={opp.funder} />
          <span className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{opp.funder ?? '—'}</span>
        </div>
        {opp.opportunity_type && <OpportunityTypeBadge type={opp.opportunity_type} size="xs" />}
        {opp.short_summary && (
          <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--ink-muted)' }}>{opp.short_summary}</p>
        )}
        <p className="mono-data text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
          {formatDate(opp.deadline) ?? 'No deadline listed'}
        </p>
      </Link>
      <div className="px-3 pb-2.5 flex items-center justify-end" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
        <OpportunityActions opp={opp} mode={mode} className="pt-2" {...handlers} />
      </div>
    </div>
  );
}

export default function ShortlistCardRows({ items, mode, priorityFunderGroups, funderOrgs, onNavigate, ...handlers }: Props) {
  const [groupMode, setGroupMode] = useState<GroupMode>('type');

  useEffect(() => {
    const saved = localStorage.getItem(GROUP_STORAGE_KEY);
    if (saved === 'type' || saved === 'funderOrg' || saved === 'funderGroup') setGroupMode(saved);
  }, []);

  function setMode(m: GroupMode) {
    setGroupMode(m);
    localStorage.setItem(GROUP_STORAGE_KEY, m);
  }

  const rows: Row[] =
    groupMode === 'funderOrg' ? groupByFunderOrg(items, funderOrgs ?? [])
    : groupMode === 'funderGroup' ? groupByFunderGroup(items, priorityFunderGroups ?? [])
    : groupByType(items);

  if (items.length === 0) {
    return (
      <div
        className="px-5 py-16 text-center text-sm"
        style={{ color: 'var(--ink-faint)', border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)' }}
      >
        {mode === 'shortlist'
          ? 'Your shortlist is empty. Bookmark opportunities from the queue to add them here.'
          : 'No opportunities on the org shortlist yet. Promote items from your personal shortlist.'}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center overflow-hidden mb-4 w-fit"
        style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-sm)' }}
      >
        {([
          { id: 'type' as GroupMode, label: 'Type' },
          { id: 'funderOrg' as GroupMode, label: 'Funder Org' },
          { id: 'funderGroup' as GroupMode, label: 'Funder Group' },
        ]).map(opt => {
          const active = groupMode === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setMode(opt.id)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: active ? 'var(--ink-primary)' : 'transparent',
                color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
              }}
            >
              Group by: {opt.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-6">
        {rows.map(row => (
          <div key={row.label}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>
              {row.label} <span className="mono-data" style={{ color: 'var(--ink-faint)' }}>· {row.items.length}</span>
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {row.items.map(opp => (
                <Card key={opp.id} opp={opp} mode={mode} onNavigate={onNavigate} {...handlers} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
