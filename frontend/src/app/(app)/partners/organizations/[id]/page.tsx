'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Globe, MapPin, Building2, GraduationCap, Pencil, Check, X } from 'lucide-react';
import { partnerOrgs, partners as partnersApi } from '@/lib/api';

interface Org {
  id: string;
  name: string;
  org_type?: string;
  website?: string;
  domain?: string;
  country?: string;
  city?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  contacts?: ContactSummary[];
}

interface ContactSummary {
  id: string;
  name: string;
  title?: string;
  email?: string;
  relationship_stage: string;
  h_index?: number;
  updated_at?: string;
  next_contact_date?: string;
}

const STAGE_STYLES: Record<string, string> = {
  prospect: 'text-gray-500 bg-gray-100',
  qualified: 'text-blue-700 bg-blue-50',
  engaged: 'text-indigo-700 bg-indigo-50',
  collaborating: 'text-green-700 bg-green-50',
  alumni: 'text-amber-700 bg-amber-50',
};
const STAGE_LABELS: Record<string, string> = {
  prospect: 'Prospect', qualified: 'Qualified', engaged: 'Engaged',
  collaborating: 'Collaborating', alumni: 'Alumni',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

type ActiveTab = 'contacts' | 'grants' | 'notes';

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('contacts');
  const [notesValue, setNotesValue] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [linkedGrants, setLinkedGrants] = useState<{id: string; title: string; type: string; entity_id: string; entity_type: string; relationship: string}[]>([]);

  const fetchOrg = useCallback(async () => {
    try {
      const res = await partnerOrgs.get(id);
      setOrg(res.data);
      setNotesValue(res.data.notes ?? '');
      setNotesDirty(false);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { if (id) fetchOrg(); }, [id, fetchOrg]);

  // Fetch all grants linked to any contact at this org
  useEffect(() => {
    if (!org?.contacts?.length) return;
    const fetchGrantLinks = async () => {
      const allLinks: typeof linkedGrants = [];
      for (const contact of org.contacts || []) {
        try {
          const res = await partnersApi.listLinks(contact.id);
          for (const lnk of res.data || []) {
            if (!allLinks.find(l => l.entity_id === lnk.entity_id)) {
              allLinks.push({
                id: lnk.id,
                title: lnk.entity_title || lnk.entity_id,
                type: lnk.entity_type,
                entity_id: lnk.entity_id,
                entity_type: lnk.entity_type,
                relationship: lnk.relationship,
              });
            }
          }
        } catch { /* ignore */ }
      }
      setLinkedGrants(allLinks);
    };
    fetchGrantLinks();
  }, [org?.contacts]);

  async function handleSaveNotes() {
    setNotesSaving(true);
    try {
      await partnerOrgs.update(id, { notes: notesValue });
      setNotesDirty(false);
    } finally { setNotesSaving(false); }
  }

  async function handleSaveName() {
    if (!nameDraft.trim()) return;
    await partnerOrgs.update(id, { name: nameDraft.trim() });
    setOrg(o => o ? { ...o, name: nameDraft.trim() } : o);
    setEditingName(false);
  }

  if (loading) {
    return (
      <div className="px-6 py-6 max-w-5xl mx-auto animate-pulse">
        <div className="h-3 w-48 bg-gray-200 rounded mb-6" />
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <div className="h-6 w-64 bg-gray-200 rounded" />
          <div className="h-3 w-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="px-8 py-16 text-center text-gray-500 text-sm">
        Organization not found.{' '}
        <Link href="/partners" className="text-blue-600 hover:underline">Back to partners</Link>
      </div>
    );
  }

  const contacts = org.contacts || [];
  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'contacts', label: `Contacts (${contacts.length})` },
    { key: 'grants', label: `Linked Grants (${linkedGrants.length})` },
    { key: 'notes', label: 'Notes' },
  ];

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-5 flex items-center gap-2">
        <Link href="/partners" className="hover:text-gray-700">Partners</Link>
        <span>/</span>
        <span className="text-gray-400">Organizations</span>
        <span>/</span>
        <span className="text-gray-600">{org.name}</span>
      </div>

      {/* Org header card */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-xl flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            {/* Inline name editing */}
            {editingName ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                  autoFocus
                  className="text-xl font-semibold border border-blue-400 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={handleSaveName} className="p-0.5 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                <button onClick={() => setEditingName(false)} className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group mb-1">
                <h1 className="text-xl font-semibold text-gray-900">{org.name}</h1>
                <button
                  onClick={() => { setNameDraft(org.name); setEditingName(true); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-blue-600 rounded transition-opacity"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              {org.org_type && (
                <span className="capitalize">{org.org_type.replace(/_/g, ' ')}</span>
              )}
              {(org.city || org.country) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {[org.city, org.country].filter(Boolean).join(', ')}
                </span>
              )}
              {org.website && (
                <a href={org.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-blue-600">
                  <Globe className="w-3 h-3" />Website
                </a>
              )}
              {org.domain && (
                <span className="text-gray-400">@{org.domain}</span>
              )}
            </div>

            {org.description && (
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">{org.description}</p>
            )}

            {org.tags && org.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {org.tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-200 bg-gray-50/60">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {activeTab === 'contacts' && (
            <div>
              {contacts.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-10">
                  No contacts at this organization yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left py-2 pb-3 font-semibold">Name</th>
                      <th className="text-left py-2 pb-3 font-semibold hidden md:table-cell">Title</th>
                      <th className="text-left py-2 pb-3 font-semibold hidden sm:table-cell">Stage</th>
                      <th className="text-left py-2 pb-3 font-semibold hidden lg:table-cell">h-index</th>
                      <th className="text-left py-2 pb-3 font-semibold hidden xl:table-cell">Last Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {contacts.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 pr-4">
                          <Link href={`/partners/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600 block">
                            {c.name}
                          </Link>
                          {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-500 hidden md:table-cell">
                          {c.title || '—'}
                        </td>
                        <td className="py-2.5 pr-4 hidden sm:table-cell">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_STYLES[c.relationship_stage] || STAGE_STYLES.prospect}`}>
                            {STAGE_LABELS[c.relationship_stage] || c.relationship_stage}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 hidden lg:table-cell">
                          {c.h_index != null ? (
                            <span className="flex items-center gap-1 text-xs text-purple-700">
                              <GraduationCap className="w-3 h-3" />h-{c.h_index}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 text-gray-400 text-xs hidden xl:table-cell">
                          {formatDate(c.updated_at) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'grants' && (
            <div>
              {linkedGrants.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-10">
                  No grants linked to contacts at this organization.
                </div>
              ) : (
                <div className="space-y-2">
                  {linkedGrants.map(g => (
                    <div key={g.id} className="border border-gray-100 rounded-lg p-3.5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-400 uppercase font-semibold">{g.entity_type}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                          {g.relationship.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <Link
                        href={`/${g.entity_type === 'grant' ? 'grants' : 'opportunities'}/${g.entity_id}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {g.title}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'notes' && (
            <div>
              <textarea
                rows={8}
                value={notesValue}
                onChange={e => { setNotesValue(e.target.value); setNotesDirty(true); }}
                placeholder="Organization-level notes, background, history…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
              />
              {notesDirty && (
                <button onClick={handleSaveNotes} disabled={notesSaving}
                  className="mt-2 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md disabled:opacity-40 hover:bg-blue-700">
                  {notesSaving ? 'Saving…' : 'Save notes'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
