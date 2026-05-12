'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { partners as partnersApi } from '@/lib/api';
import PartnerTagChip from '@/components/crm/PartnerTagChip';
import PartnerForm from '@/components/crm/PartnerForm';

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
  overdue?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  prospect: 'bg-yellow-100 text-yellow-800',
  inactive: 'bg-gray-100 text-gray-500',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

export default function PartnersPage() {
  const [partnerList, setPartnerList] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [upcomingCount, setUpcomingCount] = useState(0);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (search) params.q = search;
      if (statusFilter) params.status = statusFilter;
      if (tagFilter) params.tag = tagFilter;
      const res = await partnersApi.list(params);
      setPartnerList(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, tagFilter]);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  useEffect(() => {
    partnersApi.upcomingContacts(14).then(res => {
      setUpcomingCount(res.data.length);
    }).catch(() => {});
  }, []);

  async function handleCreate(data: Record<string, unknown>) {
    await partnersApi.create(data);
    setShowForm(false);
    fetchPartners();
  }

  // Collect all unique tags from loaded partners for quick filter chips
  const allTags = Array.from(new Set(partnerList.flatMap(p => p.tags)));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Partners</h1>
          <p className="text-sm text-gray-500 mt-0.5">Research partners and collaborators CRM</p>
        </div>
        <div className="flex items-center gap-3">
          {upcomingCount > 0 && (
            <Link href="/partners?upcoming=1"
              className="flex items-center gap-1.5 text-sm text-orange-700 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-lg hover:bg-orange-100">
              📅 {upcomingCount} contact{upcomingCount !== 1 ? 's' : ''} due soon
            </Link>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + New Partner
          </button>
        </div>
      </div>

      {/* New Partner Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">New Partner</h2>
            </div>
            <div className="px-6 py-4">
              <PartnerForm
                onSubmit={handleCreate}
                onCancel={() => setShowForm(false)}
                submitLabel="Create Partner"
              />
            </div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by name, email, organization…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          value={tagFilter}
          onChange={e => setTagFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(search || statusFilter || tagFilter) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); setTagFilter(''); }}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Partner grid */}
      {loading ? (
        <div className="flex justify-center py-16 text-gray-400 text-sm">Loading partners…</div>
      ) : partnerList.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🤝</div>
          <div className="font-medium text-gray-600 mb-1">No partners found</div>
          <div className="text-sm">Add your first partner to start building your CRM.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {partnerList.map(p => (
            <Link key={p.id} href={`/partners/${p.id}`}>
              <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer h-full">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{p.name}</div>
                    {p.organization && (
                      <div className="text-xs text-gray-500 truncate">{p.organization}</div>
                    )}
                    {p.title && (
                      <div className="text-xs text-gray-400 truncate">{p.title}</div>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] ?? STATUS_COLORS.active}`}>
                    {p.status}
                  </span>
                </div>

                {/* Contact info */}
                {p.email && (
                  <div className="text-xs text-gray-500 mb-2 truncate">✉ {p.email}</div>
                )}

                {/* Tags */}
                {p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {p.tags.slice(0, 4).map(t => <PartnerTagChip key={t} tag={t} />)}
                    {p.tags.length > 4 && (
                      <span className="text-xs text-gray-400">+{p.tags.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Project types */}
                {p.project_types.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {p.project_types.slice(0, 3).map(t => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">{t}</span>
                    ))}
                    {p.project_types.length > 3 && (
                      <span className="text-xs text-gray-400">+{p.project_types.length - 3}</span>
                    )}
                  </div>
                )}

                {/* Next contact */}
                {p.next_contact_date && (
                  <div className={`mt-2 text-xs font-medium flex items-center gap-1 ${
                    isOverdue(p.next_contact_date) ? 'text-red-600' : 'text-blue-600'
                  }`}>
                    <span>📅</span>
                    <span>
                      {isOverdue(p.next_contact_date) ? 'Overdue: ' : 'Follow up: '}
                      {formatDate(p.next_contact_date)}
                    </span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
