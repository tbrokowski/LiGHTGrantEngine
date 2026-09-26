'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Linkedin, Globe, Mail, Phone, MapPin, GraduationCap, CheckSquare, ExternalLink, X } from 'lucide-react';
import { partners as partnersApi, partnerGroups } from '@/lib/api';
import OwnerSelect from './OwnerSelect';
import AddToGroupModal from './AddToGroupModal';
import GroupFormModal from './GroupFormModal';
import { Avatar, GroupRef, PrioritySwitch, TagPill, WeekStrip, btnPrimary, btnQuiet, card, sinceLabel } from './crmUi';

interface PartnerHeroProps {
  partner: {
    id: string;
    name: string;
    title?: string;
    organization?: string;
    department?: string;
    country?: string;
    city?: string;
    email?: string;
    phone?: string;
    linkedin_url?: string;
    website?: string;
    h_index?: number;
    orcid?: string;
    tags: string[];
    bio?: string | null;
    enrichment_sources?: string[];
    enrichment_status: string;
    last_enriched_at?: string;
    org_info?: { id: string; name: string; org_type: string } | null;
    owner_id?: string | null;
    owner_name?: string | null;
    task_count?: number;
    priority?: number;
    groups?: GroupRef[];
    weeks?: number[];
    last_touch?: string | null;
    last_touch_kind?: string | null;
    touches_90d?: number;
  };
  onEnrich: () => void;
  onScheduleMeeting: () => void;
  onDraftEmail: () => void;
  onAddToGrant: () => void;
  onOwnerChange?: (ownerId: string | null, ownerName: string | null) => void;
  onAddTask?: () => void;
  onChanged?: () => void;
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Researching online…',
  not_found: 'Nothing found online',
  failed: 'Research failed — try again',
  none: 'Profile not researched',
};

export default function PartnerHero({
  partner, onEnrich, onScheduleMeeting, onDraftEmail, onAddToGrant, onOwnerChange, onAddTask, onChanged,
}: PartnerHeroProps) {
  const [enriching, setEnriching] = useState(false);
  const [priority, setPriority] = useState(partner.priority ?? 1);
  const [groups, setGroups] = useState<GroupRef[]>(partner.groups ?? []);
  const [groupModal, setGroupModal] = useState<null | 'add' | 'new'>(null);
  useEffect(() => { setGroups(partner.groups ?? []); }, [partner.groups]);
  useEffect(() => { setPriority(partner.priority ?? 1); }, [partner.priority]);

  async function handleEnrich() {
    setEnriching(true);
    try { await partnersApi.enrich(partner.id); onEnrich(); } finally { setEnriching(false); }
  }

  async function changePriority(p: number) {
    setPriority(p);
    try { await partnersApi.update(partner.id, { priority: p }); } catch { setPriority(partner.priority ?? 1); }
  }

  async function leaveGroup(g: GroupRef) {
    setGroups(gs => gs.filter(x => x.id !== g.id));
    await partnerGroups.removeMember(g.id, partner.id).catch(() => {});
    onChanged?.();
  }

  const location = [partner.city, partner.country].filter(Boolean).join(', ');
  // No label once research is done; only in-progress / problem states show.
  const researched = partner.enrichment_status === 'done' ? '' : STATUS_TEXT[partner.enrichment_status] ?? STATUS_TEXT.none;
  const weeks = partner.weeks ?? [];
  const touchedWeeks = weeks.filter(n => n > 0).length;
  const days = partner.last_touch ? Math.floor((Date.now() - new Date(partner.last_touch).getTime()) / 86_400_000) : null;
  const health = days === null
    ? { label: 'No contact yet', color: 'var(--ink-muted)' }
    : days < 21 ? { label: 'Warm', color: 'var(--state-success)' }
      : days < 60 ? { label: 'Cooling', color: 'var(--state-warning)' }
        : { label: 'Cold', color: 'var(--state-danger)' };

  const link = 'flex items-center gap-1 hover:underline';

  return (
    <div style={card} className="overflow-hidden">
      <div className="px-5 py-2 flex items-center justify-between text-xs" style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--rule-subtle)' }}>
        <span style={{ color: 'var(--ink-muted)' }}>{researched}</span>
        <button type="button" onClick={handleEnrich} disabled={enriching || partner.enrichment_status === 'pending'}
          className="flex items-center gap-1 font-medium disabled:opacity-40" style={{ color: 'var(--ink-secondary)' }}>
          <RefreshCw className={`w-3 h-3 ${enriching || partner.enrichment_status === 'pending' ? 'animate-spin' : ''}`} />
          {partner.enrichment_status === 'done' ? 'Refresh research' : 'Research online'}
        </button>
      </div>

      <div className="p-5 flex flex-col lg:flex-row gap-6">
        <div className="flex gap-4 flex-1 min-w-0">
          <Avatar name={partner.name} size={64} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>{partner.name}</h1>
              {partner.h_index != null && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
                  <GraduationCap className="w-3 h-3" />h-index <span className="mono-data">{partner.h_index}</span>
                </span>
              )}
            </div>
            <div className="mt-2"><PrioritySwitch value={priority} onChange={changePriority} /></div>
            <div className="text-sm mt-2" style={{ color: 'var(--ink-secondary)' }}>
              {[partner.title, partner.department, partner.organization].filter(Boolean).join(' · ') || <span style={{ color: 'var(--ink-muted)' }}>No title or institution yet</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>
              {partner.email && <a href={`mailto:${partner.email}`} className={`${link} mono-data`}><Mail className="w-3 h-3" />{partner.email}</a>}
              {partner.phone && <a href={`tel:${partner.phone}`} className={link}><Phone className="w-3 h-3" />{partner.phone}</a>}
              {location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{location}</span>}
              {partner.linkedin_url && <a href={partner.linkedin_url} target="_blank" rel="noopener noreferrer" className={link}><Linkedin className="w-3 h-3" />LinkedIn</a>}
              {partner.website && <a href={partner.website} target="_blank" rel="noopener noreferrer" className={link}><Globe className="w-3 h-3" />Profile page</a>}
              {partner.orcid && <a href={`https://orcid.org/${partner.orcid}`} target="_blank" rel="noopener noreferrer" className={link}><ExternalLink className="w-3 h-3" />ORCID</a>}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-3.5">
              {groups.map(g => (
                <span key={g.id} className="group inline-flex items-center gap-1.5 text-xs font-medium pl-2.5 pr-1.5 py-0.5 rounded-full" style={{ background: 'var(--surface-sunken)', color: g.color || 'var(--ink-secondary)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: g.color || 'var(--ink-muted)' }} />
                  <Link href={`/partners/groups/${g.id}`} className="hover:underline">{g.name}</Link>
                  <button type="button" onClick={() => leaveGroup(g)} aria-label={`Remove from ${g.name}`} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {partner.tags.map(t => <TagPill key={t} label={t} />)}
              <button type="button" onClick={() => setGroupModal('add')} className="text-xs px-2.5 py-0.5 rounded-full"
                style={{ border: '1px dashed var(--rule-strong)', color: 'var(--ink-muted)' }}>
                + Add to group
              </button>
            </div>

            {onOwnerChange && (
              <div className="flex items-center gap-3 mt-3">
                <OwnerSelect ownerId={partner.owner_id} ownerName={partner.owner_name} onChange={onOwnerChange} />
                {(partner.task_count ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)' }}>
                    <CheckSquare className="w-3 h-3" />{partner.task_count} open task{partner.task_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:w-[290px] shrink-0 flex flex-col gap-2">
          <button type="button" onClick={onDraftEmail} className="h-9 text-[13px] font-medium" style={btnPrimary}>Draft email</button>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={onScheduleMeeting} className="h-[34px] text-xs" style={btnQuiet}>Meeting</button>
            <button type="button" onClick={onAddTask} className="h-[34px] text-xs" style={btnQuiet}>Task</button>
            <button type="button" onClick={onAddToGrant} className="h-[34px] text-xs" style={btnQuiet}>Link grant</button>
          </div>
          <div className="mt-1.5 p-3 rounded-[var(--radius-md)]" style={{ background: 'var(--surface-sunken)' }}>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--ink-muted)' }}>Relationship health</span>
              <span className="font-medium" style={{ color: health.color }}>{health.label}</span>
            </div>
            {weeks.length > 0 && <div className="mt-2"><WeekStrip weeks={weeks} cell={18} height={14} /></div>}
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--ink-muted)' }}>
              {partner.last_touch
                ? `Last contact ${sinceLabel(partner.last_touch)}${partner.last_touch_kind ? ` (${partner.last_touch_kind})` : ''} · touched ${touchedWeeks} of the last 12 weeks`
                : 'Log an email, call or meeting to start tracking.'}
            </div>
          </div>
        </div>
      </div>

      {partner.bio && (
        <div className="px-5 pb-5">
          <div className="pt-4" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
            <div className="ledger-label mb-1.5">About</div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>{partner.bio}</p>
            {(partner.enrichment_sources?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                <span>Sources:</span>
                {partner.enrichment_sources!.map(u => {
                  let host = u;
                  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
                  return <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{host}</a>;
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {groupModal === 'add' && (
        <AddToGroupModal
          partnerIds={[partner.id]}
          onClose={() => setGroupModal(null)}
          onDone={() => onChanged?.()}
          onNewGroup={() => setGroupModal('new')}
        />
      )}
      {groupModal === 'new' && (
        <GroupFormModal partnerIds={[partner.id]} onClose={() => setGroupModal(null)} onSaved={() => onChanged?.()} />
      )}
    </div>
  );
}

/** Kept for older CRM views (Kanban) that import it from here. */
export function InitialsAvatar({ name, size = 'lg' }: { name: string; size?: 'sm' | 'lg' }) {
  return <Avatar name={name} size={size === 'lg' ? 64 : 32} />;
}
