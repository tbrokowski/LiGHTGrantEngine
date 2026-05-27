'use client';
import { useEffect, useState, useCallback } from 'react';
import { organizations } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  institution_role: string;
  module_permissions: Record<string, boolean>;
  created_at: string | null;
}

interface OrgGrant {
  id: string;
  title: string;
  funder: string | null;
  grant_stage: string | null;
  status: string | null;
}

interface GrantAccess {
  grant_ids: string[];
  owner_grant_ids: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ROLES = [
  { value: 'grant_lead', label: 'Grant Lead' },
  { value: 'operations_manager', label: 'Ops Manager' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'viewer', label: 'Viewer' },
];

const STAGE_ORDER: Record<string, number> = { active: 0, pending: 1, proposal: 2 };
const STAGE_LABEL: Record<string, string> = { active: 'Active', pending: 'Pending', proposal: 'Proposal' };

const DEFAULT_PERMS: Record<string, boolean> = {
  can_view_grants: false,
  can_view_archive: true,
  can_view_partners: true,
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function Toggle({
  value,
  disabled,
  onChange,
  color = 'gray',
}: {
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  color?: 'gray' | 'purple';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed ${
        value
          ? color === 'purple' ? 'bg-purple-600 focus:ring-purple-500' : 'bg-gray-800 focus:ring-gray-900'
          : 'bg-gray-300 focus:ring-gray-400'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-2">
      {children}
    </p>
  );
}

// ── Expanded member panel ─────────────────────────────────────────────────────

function MemberAccordion({
  member,
  institutionId,
  orgGrants,
  isSelf,
  onUpdate,
  onRemove,
}: {
  member: Member;
  institutionId: string;
  orgGrants: OrgGrant[];
  isSelf: boolean;
  onUpdate: (patch: Partial<Member>) => void;
  onRemove: () => void;
}) {
  const [grantAccess, setGrantAccess] = useState<GrantAccess | null>(null);
  const [loadingGrants, setLoadingGrants] = useState(true);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [grantSaving, setGrantSaving] = useState(false);

  const perms = { ...DEFAULT_PERMS, ...(member.module_permissions || {}) };

  // Load grant memberships when accordion opens
  useEffect(() => {
    setLoadingGrants(true);
    organizations.getMemberGrantMemberships(institutionId, member.id)
      .then(r => setGrantAccess(r.data))
      .catch(() => setGrantAccess({ grant_ids: [], owner_grant_ids: [] }))
      .finally(() => setLoadingGrants(false));
  }, [institutionId, member.id]);

  async function handleRoleChange(role: string) {
    setSavingField('role');
    try {
      await organizations.updateMember(institutionId, member.id, { role, institution_role: member.institution_role });
      onUpdate({ role });
    } catch { alert('Failed to update role.'); }
    finally { setSavingField(null); }
  }

  async function handleAdminToggle(val: boolean) {
    if (isSelf) { alert('You cannot change your own admin status.'); return; }
    setSavingField('admin');
    const newInstRole = val ? 'admin' : 'member';
    try {
      await organizations.updateMember(institutionId, member.id, {
        role: member.role,
        institution_role: newInstRole,
      });
      onUpdate({ institution_role: newInstRole });
    } catch { alert('Failed to update admin status.'); }
    finally { setSavingField(null); }
  }

  async function handleModuleToggle(key: string, val: boolean) {
    setSavingField(key);
    const next = { ...perms, [key]: val };
    try {
      await organizations.updateMember(institutionId, member.id, {
        role: member.role,
        module_permissions: next,
      });
      onUpdate({ module_permissions: next });
    } catch { alert('Failed to update permission.'); }
    finally { setSavingField(null); }
  }

  async function handleGrantToggle(grantId: string, checked: boolean) {
    if (!grantAccess) return;
    const current = new Set(grantAccess.grant_ids);
    if (checked) {
      current.add(grantId);
    } else {
      current.delete(grantId);
    }
    const nextIds = Array.from(current);
    setGrantSaving(true);
    try {
      const res = await organizations.setMemberGrantMemberships(institutionId, member.id, nextIds);
      setGrantAccess(prev => prev ? { ...prev, grant_ids: res.data.grant_ids } : prev);
    } catch { alert('Failed to update grant access.'); }
    finally { setGrantSaving(false); }
  }

  const sortedGrants = [...orgGrants].sort((a, b) => {
    const stageA = STAGE_ORDER[a.grant_stage ?? ''] ?? 9;
    const stageB = STAGE_ORDER[b.grant_stage ?? ''] ?? 9;
    if (stageA !== stageB) return stageA - stageB;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });

  const grantIdSet = new Set(grantAccess?.grant_ids ?? []);
  const ownerSet = new Set(grantAccess?.owner_grant_ids ?? []);
  const allGrantsOverride = perms.can_view_grants;

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-5 space-y-5">
      {/* Role & Admin */}
      <div>
        <SectionLabel>Role & Access</SectionLabel>
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-8">Role</span>
            <select
              value={member.role}
              disabled={savingField === 'role'}
              onChange={e => handleRoleChange(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              {USER_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Toggle
              value={member.institution_role === 'admin'}
              disabled={!!savingField || isSelf}
              onChange={handleAdminToggle}
              color="purple"
            />
            <span className="text-xs text-gray-700">Org Admin</span>
            {isSelf && <span className="text-xs text-gray-400">(cannot change)</span>}
          </div>
        </div>
      </div>

      {/* Module access */}
      <div>
        <SectionLabel>Module Access</SectionLabel>
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          {[
            { key: 'can_view_archive', label: 'Archive' },
            { key: 'can_view_partners', label: 'Partners' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <Toggle
                value={perms[key] ?? false}
                disabled={savingField === key}
                onChange={v => handleModuleToggle(key, v)}
              />
              <span className="text-xs text-gray-700">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grant access */}
      <div>
        <SectionLabel>Grant Access</SectionLabel>

        {/* All-grants override toggle */}
        <div className="flex items-center gap-2 mb-3">
          <Toggle
            value={allGrantsOverride}
            disabled={savingField === 'can_view_grants'}
            onChange={v => handleModuleToggle('can_view_grants', v)}
          />
          <span className="text-xs text-gray-700 font-medium">All Grants (see entire portfolio)</span>
        </div>

        {/* Per-grant checkboxes */}
        {loadingGrants ? (
          <p className="text-xs text-gray-400 pl-1">Loading grants…</p>
        ) : orgGrants.length === 0 ? (
          <p className="text-xs text-gray-400 pl-1">No grants in this organization yet.</p>
        ) : (
          <div className={`space-y-1 ${allGrantsOverride ? 'opacity-50 pointer-events-none' : ''}`}>
            {allGrantsOverride && (
              <p className="text-xs text-gray-500 italic mb-2 pl-1">
                All Grants override is on — individual selections are ignored while active.
              </p>
            )}
            {sortedGrants.map(grant => {
              const checked = grantIdSet.has(grant.id);
              const isOwner = ownerSet.has(grant.id);
              const stage = STAGE_LABEL[grant.grant_stage ?? ''] ?? grant.grant_stage ?? '';
              return (
                <label
                  key={grant.id}
                  className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                    checked ? 'bg-white border border-gray-200' : 'hover:bg-white'
                  } cursor-pointer`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-gray-800 focus:ring-gray-600 cursor-pointer"
                    checked={checked}
                    disabled={grantSaving || isOwner}
                    onChange={e => handleGrantToggle(grant.id, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-gray-800 leading-tight block truncate">
                      {grant.title}
                    </span>
                    <span className="text-[10px] text-gray-400 leading-none">
                      {[stage, grant.funder].filter(Boolean).join(' · ')}
                      {isOwner && <span className="ml-1 text-purple-500">(owner)</span>}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Remove */}
      {!isSelf && (
        <div className="pt-1 border-t border-gray-200">
          <button
            onClick={onRemove}
            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
          >
            Remove from organization
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function MembersPanel({ institutionId }: { institutionId: string }) {
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [orgGrants, setOrgGrants] = useState<OrgGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [membersRes, grantsRes] = await Promise.all([
        organizations.members(institutionId),
        organizations.orgGrants(institutionId),
      ]);
      setMembers(membersRes.data);
      setOrgGrants(grantsRes.data);
    } catch {
      setError('Failed to load members.');
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  function handleToggleExpand(memberId: string) {
    setExpandedId(prev => (prev === memberId ? null : memberId));
  }

  function handleUpdate(userId: string, patch: Partial<Member>) {
    setMembers(prev => prev.map(m => (m.id === userId ? { ...m, ...patch } : m)));
  }

  async function handleRemove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the organization?`)) return;
    try {
      await organizations.removeMember(institutionId, userId);
      setMembers(prev => prev.filter(m => m.id !== userId));
      if (expandedId === userId) setExpandedId(null);
    } catch {
      alert('Failed to remove member.');
    }
  }

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase()),
  );

  // Admins first, then by name
  const sorted = [...filtered].sort((a, b) => {
    const aAdmin = a.institution_role === 'admin' ? 0 : 1;
    const bAdmin = b.institution_role === 'admin' ? 0 : 1;
    if (aAdmin !== bAdmin) return aAdmin - bAdmin;
    return a.name.localeCompare(b.name);
  });

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading members…</div>;
  if (error) return <div className="text-sm text-red-500 py-4">{error}</div>;

  return (
    <div>
      {/* Header + search */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <h3 className="text-sm font-semibold text-gray-900 shrink-0">
          Members
          <span className="ml-1.5 text-gray-400 font-normal">({members.length})</span>
        </h3>
        <div className="relative max-w-64 w-full">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {sorted.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">
            {search ? 'No members match your search.' : 'No members found.'}
          </p>
        )}

        {sorted.map(m => {
          const isAdmin = m.institution_role === 'admin';
          const isSelf = m.id === currentUser?.id;
          const isExpanded = expandedId === m.id;

          return (
            <div
              key={m.id}
              className={`rounded-xl border transition-shadow ${
                isAdmin
                  ? 'border-purple-200 bg-purple-50'
                  : 'border-gray-200 bg-white hover:shadow-sm'
              }`}
            >
              {/* Member row — always visible */}
              <button
                type="button"
                onClick={() => handleToggleExpand(m.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                    isAdmin ? 'bg-purple-200 text-purple-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {m.name.charAt(0).toUpperCase()}
                </div>

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-sm font-semibold truncate ${isAdmin ? 'text-purple-900' : 'text-gray-900'}`}>
                      {m.name}
                    </span>
                    {isSelf && (
                      <span className="text-xs text-gray-400">(you)</span>
                    )}
                    {isAdmin ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-200 text-purple-800 uppercase tracking-wide">
                        Admin
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 capitalize">
                        {m.role.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>

                {/* Chevron */}
                <svg
                  className={`w-4 h-4 shrink-0 transition-transform ${
                    isAdmin ? 'text-purple-400' : 'text-gray-400'
                  } ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded accordion */}
              {isExpanded && (
                <MemberAccordion
                  member={m}
                  institutionId={institutionId}
                  orgGrants={orgGrants}
                  isSelf={isSelf}
                  onUpdate={patch => handleUpdate(m.id, patch)}
                  onRemove={() => handleRemove(m.id, m.name)}
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Org Admins have full access to everything. Grant access controls which individual grants a member can view and work on.
      </p>
    </div>
  );
}
