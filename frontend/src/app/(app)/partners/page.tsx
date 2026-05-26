'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { partners as partnersApi } from '@/lib/api';
import PartnerForm, { PartnerFormData } from '@/components/crm/PartnerForm';

interface Partner {
  id: string;
  name: string;
  email?: string;
  organization?: string;
  title?: string;
  tags: string[];
  project_types: string[];
  status: string;
  updated_at?: string;
  next_contact_date?: string;
}

type GroupBy = 'person' | 'organization';

interface PartnerGroup {
  key: string;
  label: string;
  partners: Partner[];
}

const STATUS_STYLES: Record<string, string> = {
  active: 'text-green-700 bg-green-50',
  prospect: 'text-amber-700 bg-amber-50',
  inactive: 'text-gray-500 bg-gray-100',
};

const GROUP_BY_STORAGE_KEY = 'partners_group_by';

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

function orgLabel(organization?: string | null) {
  const trimmed = organization?.trim();
  return trimmed || 'No organization';
}

function groupPartners(partners: Partner[], groupBy: GroupBy): PartnerGroup[] {
  if (groupBy === 'person') {
    return [{
      key: '__all__',
      label: '',
      partners: [...partners].sort((a, b) => a.name.localeCompare(b.name)),
    }];
  }

  const groups = new Map<string, Partner[]>();
  for (const partner of partners) {
    const label = orgLabel(partner.organization);
    const existing = groups.get(label);
    if (existing) existing.push(partner);
    else groups.set(label, [partner]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === 'No organization') return 1;
      if (b === 'No organization') return -1;
      return a.localeCompare(b);
    })
    .map(([label, groupPartners]) => ({
      key: label,
      label,
      partners: groupPartners.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function PartnerRow({
  partner,
  showOrganization,
  indented,
}: {
  partner: Partner;
  showOrganization: boolean;
  indented?: boolean;
}) {
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className={`py-3.5 ${indented ? 'pl-10 pr-5' : 'px-5'}`}>
        <Link href={`/partners/${partner.id}`} className="font-medium text-gray-900 hover:text-blue-700 block">
          {partner.name}
        </Link>
        {partner.email && <div className="text-xs text-gray-400 mt-0.5">{partner.email}</div>}
        {!showOrganization && partner.title && (
          <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[240px]">{partner.title}</div>
        )}
      </td>
      {showOrganization && (
        <td className="px-4 py-3.5 text-gray-600 hidden md:table-cell">
          <div className="truncate max-w-[180px]">{partner.organization ?? '—'}</div>
          {partner.title && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[180px]">{partner.title}</div>}
        </td>
      )}
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {partner.tags.slice(0, 3).map(t => (
            <span key={t} className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{t}</span>
          ))}
          {partner.tags.length > 3 && (
            <span className="text-xs text-gray-400">+{partner.tags.length - 3}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        {partner.next_contact_date ? (
          <span className={`text-xs font-medium ${isOverdue(partner.next_contact_date) ? 'text-red-600' : 'text-gray-600'}`}>
            {isOverdue(partner.next_contact_date) ? 'Overdue · ' : ''}{formatDate(partner.next_contact_date)}
          </span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[partner.status] ?? 'text-gray-500 bg-gray-100'}`}>
          {partner.status}
        </span>
      </td>
    </tr>
  );
}

export default function PartnersPage() {
  const [partnerList, setPartnerList] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('person');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [upcomingCount, setUpcomingCount] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem(GROUP_BY_STORAGE_KEY);
    if (saved === 'person' || saved === 'organization') setGroupBy(saved);
  }, []);

  const groupedPartners = useMemo(
    () => groupPartners(partnerList, groupBy),
    [partnerList, groupBy],
  );

  const showOrganizationColumn = groupBy === 'person';
  const columnCount = showOrganizationColumn ? 5 : 4;

  function handleGroupByChange(value: GroupBy) {
    setGroupBy(value);
    localStorage.setItem(GROUP_BY_STORAGE_KEY, value);
    setCollapsedGroups(new Set());
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (search) params.q = search;
      if (statusFilter) params.status = statusFilter;
      const res = await partnersApi.list(params);
      setPartnerList(res.data);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  useEffect(() => {
    partnersApi.upcomingContacts(14).then(res => setUpcomingCount(res.data.length)).catch(() => {});
  }, []);

  async function handleCreate(data: PartnerFormData) {
    await partnersApi.create(data as unknown as Record<string, unknown>);
    setShowForm(false);
    fetchPartners();
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Partners</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading ? 'Loading…' : `${partnerList.length} partner${partnerList.length !== 1 ? 's' : ''}`}
            {upcomingCount > 0 && (
              <span className="ml-2 text-amber-700 font-medium">· {upcomingCount} follow-up{upcomingCount !== 1 ? 's' : ''} due</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md transition-colors"
        >
          New partner
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name, email, or organization…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="prospect">Prospect</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={groupBy}
          onChange={e => handleGroupByChange(e.target.value as GroupBy)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="person">Group by person</option>
          <option value="organization">Group by organization</option>
        </select>
        {(search || statusFilter) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {groupBy === 'organization' ? 'Organization / Name' : 'Name'}
              </th>
              {showOrganizationColumn && (
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Organization</th>
              )}
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Tags</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Next contact</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="px-5 py-12 text-center text-gray-400">Loading…</td>
              </tr>
            ) : partnerList.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-5 py-12 text-center text-gray-400">
                  {search || statusFilter ? 'No matches found.' : 'No partners yet. Add your first partner.'}
                </td>
              </tr>
            ) : (
              groupedPartners.flatMap(group => {
                const isCollapsed = collapsedGroups.has(group.key);
                const rows = [];

                if (groupBy === 'organization') {
                  rows.push(
                    <tr key={`group-${group.key}`} className="bg-gray-50/80">
                      <td colSpan={columnCount} className="px-5 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.key)}
                          className="flex items-center gap-2 text-left w-full"
                        >
                          <span className="text-gray-400 text-xs w-3">{isCollapsed ? '▸' : '▾'}</span>
                          <span className="text-sm font-semibold text-gray-800">{group.label}</span>
                          <span className="text-xs text-gray-400 font-normal">
                            {group.partners.length} contact{group.partners.length !== 1 ? 's' : ''}
                          </span>
                        </button>
                      </td>
                    </tr>,
                  );
                }

                if (!isCollapsed) {
                  for (const partner of group.partners) {
                    rows.push(
                      <PartnerRow
                        key={partner.id}
                        partner={partner}
                        showOrganization={showOrganizationColumn}
                        indented={groupBy === 'organization'}
                      />,
                    );
                  }
                }

                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* New Partner Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">New Partner</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5">
              <PartnerForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="Create partner" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
