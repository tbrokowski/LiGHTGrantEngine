'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { partners as partnersApi } from '@/lib/api';
import PartnerForm, { PartnerFormData } from '@/components/crm/PartnerForm';

interface PartnerDetail {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  title?: string;
  linkedin_url?: string;
  website?: string;
  tags: string[];
  project_types: string[];
  status: string;
  notes?: string;
  created_at?: string;
  next_contact_date?: string;
  updates: ContactUpdate[];
  grant_links: GrantLink[];
}

interface ContactUpdate {
  id: string;
  content: string;
  update_type: string;
  contact_date?: string;
  next_contact_date?: string;
  created_at?: string;
}

interface GrantLink {
  id: string;
  entity_type: string;
  entity_id: string;
  relationship: string;
  notes?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'text-green-700 bg-green-50',
  prospect: 'text-amber-700 bg-amber-50',
  inactive: 'text-gray-500 bg-gray-100',
};

const UPDATE_TYPES = ['note', 'email', 'call', 'meeting', 'other'];

const RELATIONSHIP_OPTIONS = [
  'PI', 'co-I', 'collaborator', 'funder_contact', 'reviewer',
  'advisor', 'industry_partner', 'ngo_partner', 'government_partner', 'other',
];

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function formatDateTime(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
}

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'log' | 'links' | 'edit'>('log');
  const [showLogForm, setShowLogForm] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [logType, setLogType] = useState('note');
  const [logContactDate, setLogContactDate] = useState('');
  const [logNextContact, setLogNextContact] = useState('');
  const [logSaving, setLogSaving] = useState(false);
  const [linkEntityType, setLinkEntityType] = useState('opportunity');
  const [linkEntityId, setLinkEntityId] = useState('');
  const [linkRelationship, setLinkRelationship] = useState('collaborator');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [notesEdit, setNotesEdit] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  async function fetchPartner() {
    try {
      const res = await partnersApi.get(id);
      setPartner(res.data);
      setNotesEdit(res.data.notes ?? '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (id) fetchPartner(); }, [id]);

  async function handleEditSave(data: PartnerFormData) {
    await partnersApi.update(id, data as unknown as Record<string, unknown>);
    setActiveTab('log');
    fetchPartner();
  }

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!logContent.trim()) return;
    setLogSaving(true);
    try {
      await partnersApi.addUpdate(id, {
        content: logContent,
        update_type: logType,
        contact_date: logContactDate || null,
        next_contact_date: logNextContact || null,
      });
      setLogContent(''); setLogType('note'); setLogContactDate(''); setLogNextContact('');
      setShowLogForm(false);
      fetchPartner();
    } finally { setLogSaving(false); }
  }

  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!linkEntityId.trim()) return;
    setLinkSaving(true);
    try {
      await partnersApi.addLink(id, {
        entity_type: linkEntityType,
        entity_id: linkEntityId,
        relationship: linkRelationship,
        notes: linkNotes || null,
      });
      setLinkEntityId(''); setLinkNotes('');
      setShowLinkForm(false);
      fetchPartner();
    } finally { setLinkSaving(false); }
  }

  async function handleRemoveLink(linkId: string) {
    if (!confirm('Remove this link?')) return;
    await partnersApi.deleteLink(id, linkId);
    fetchPartner();
  }

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      await partnersApi.update(id, { notes: notesEdit });
      fetchPartner();
    } finally { setSavingNotes(false); }
  }

  if (loading) return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
  if (!partner) {
    return (
      <div className="px-8 py-16 text-center text-gray-500 text-sm">
        Partner not found.{' '}
        <Link href="/partners" className="text-blue-600 hover:underline">Back to partners</Link>
      </div>
    );
  }

  const latestNextContact = partner.updates
    .filter(u => u.next_contact_date)
    .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())[0]
    ?.next_contact_date;

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      <div className="text-sm text-gray-400 mb-6 flex items-center gap-2">
        <Link href="/partners" className="hover:text-gray-700">Partners</Link>
        <span>/</span>
        <span className="text-gray-600">{partner.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Contact card */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{partner.name}</h1>
                {partner.organization && <div className="text-sm text-gray-600 mt-0.5">{partner.organization}</div>}
                {partner.title && <div className="text-xs text-gray-400 mt-0.5">{partner.title}</div>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${STATUS_STYLES[partner.status] ?? 'text-gray-500 bg-gray-100'}`}>
                {partner.status}
              </span>
            </div>

            <div className="space-y-2 text-sm border-t border-gray-100 pt-4">
              {partner.email && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 w-16">Email</span>
                  <a href={`mailto:${partner.email}`} className="text-blue-600 hover:underline text-xs truncate">{partner.email}</a>
                </div>
              )}
              {partner.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 w-16">Phone</span>
                  <a href={`tel:${partner.phone}`} className="text-gray-700 text-xs">{partner.phone}</a>
                </div>
              )}
              {partner.linkedin_url && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 w-16">LinkedIn</span>
                  <a href={partner.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">Profile</a>
                </div>
              )}
              {partner.website && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 w-16">Website</span>
                  <a href={partner.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs truncate max-w-[140px]">{partner.website}</a>
                </div>
              )}
            </div>

            {latestNextContact && (
              <div className={`mt-4 p-2.5 rounded-lg text-xs font-medium ${isOverdue(latestNextContact) ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                {isOverdue(latestNextContact) ? 'Overdue follow-up: ' : 'Next contact: '}
                {formatDate(latestNextContact)}
              </div>
            )}

            {partner.tags.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-gray-400 mb-1.5">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {partner.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {partner.project_types.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-gray-400 mb-1.5">Project types</div>
                <div className="flex flex-wrap gap-1">
                  {partner.project_types.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
              Added {formatDate(partner.created_at)}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Notes</h3>
            <textarea
              className="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-700"
              rows={5}
              value={notesEdit}
              onChange={e => setNotesEdit(e.target.value)}
              placeholder="Add notes about this partner…"
            />
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes || notesEdit === (partner.notes ?? '')}
              className="mt-2 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-40"
            >
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>

        {/* RIGHT: Tabbed panel */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 bg-white">
              {([
                { key: 'log', label: `Contact Log (${partner.updates.length})` },
                { key: 'links', label: `Linked Grants (${partner.grant_links.length})` },
                { key: 'edit', label: 'Edit Profile' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.key
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {activeTab === 'log' && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-900">Contact history</h2>
                    <button
                      onClick={() => setShowLogForm(!showLogForm)}
                      className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-50"
                    >
                      {showLogForm ? 'Cancel' : 'Log contact'}
                    </button>
                  </div>

                  {showLogForm && (
                    <form onSubmit={handleLogSubmit} className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                          <select value={logType} onChange={e => setLogType(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {UPDATE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                          <input type="datetime-local" value={logContactDate} onChange={e => setLogContactDate(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Notes *</label>
                        <textarea value={logContent} onChange={e => setLogContent(e.target.value)} required rows={3}
                          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          placeholder="What was discussed…" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Next contact date</label>
                        <input type="datetime-local" value={logNextContact} onChange={e => setLogNextContact(e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setShowLogForm(false)}
                          className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-100 text-gray-600">Cancel</button>
                        <button type="submit" disabled={logSaving}
                          className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
                          {logSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </form>
                  )}

                  {partner.updates.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center py-10">No contact log entries yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {partner.updates.map(u => (
                        <div key={u.id} className="border border-gray-100 rounded-lg p-3.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-gray-500 uppercase">{u.update_type}</span>
                            <span className="text-xs text-gray-400">{formatDateTime(u.contact_date ?? u.created_at)}</span>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{u.content}</p>
                          {u.next_contact_date && (
                            <div className="mt-2 text-xs text-blue-600">
                              Follow up: {formatDate(u.next_contact_date)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'links' && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-900">Linked grants and opportunities</h2>
                    <button
                      onClick={() => setShowLinkForm(!showLinkForm)}
                      className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-50"
                    >
                      {showLinkForm ? 'Cancel' : 'Add link'}
                    </button>
                  </div>

                  {showLinkForm && (
                    <form onSubmit={handleLinkSubmit} className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                          <select value={linkEntityType} onChange={e => setLinkEntityType(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="opportunity">Opportunity</option>
                            <option value="grant">Active Grant</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
                          <select value={linkRelationship} onChange={e => setLinkRelationship(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Grant / Opportunity ID *</label>
                        <input value={linkEntityId} onChange={e => setLinkEntityId(e.target.value)} required
                          placeholder="Paste the ID from the URL" className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                        <input value={linkNotes} onChange={e => setLinkNotes(e.target.value)}
                          placeholder="Optional context" className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setShowLinkForm(false)}
                          className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-100 text-gray-600">Cancel</button>
                        <button type="submit" disabled={linkSaving}
                          className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
                          {linkSaving ? 'Linking…' : 'Link'}
                        </button>
                      </div>
                    </form>
                  )}

                  {partner.grant_links.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center py-10">No linked grants yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {partner.grant_links.map(lnk => (
                        <div key={lnk.id} className="border border-gray-100 rounded-lg p-3.5 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-gray-400 uppercase font-semibold">{lnk.entity_type}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">{lnk.relationship.replace(/_/g, ' ')}</span>
                            </div>
                            <Link
                              href={`/${lnk.entity_type === 'grant' ? 'grants' : 'opportunities'}/${lnk.entity_id}`}
                              className="text-sm text-blue-600 hover:underline font-mono text-xs truncate block"
                            >
                              {lnk.entity_id}
                            </Link>
                            {lnk.notes && <div className="text-xs text-gray-500 mt-1">{lnk.notes}</div>}
                          </div>
                          <button onClick={() => handleRemoveLink(lnk.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none shrink-0">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'edit' && (
                <PartnerForm
                  initial={{
                    name: partner.name, email: partner.email ?? '', phone: partner.phone ?? '',
                    organization: partner.organization ?? '', title: partner.title ?? '',
                    linkedin_url: partner.linkedin_url ?? '', website: partner.website ?? '',
                    tags: partner.tags, project_types: partner.project_types,
                    status: partner.status, notes: partner.notes ?? '',
                  }}
                  onSubmit={handleEditSave}
                  onCancel={() => setActiveTab('log')}
                  submitLabel="Save changes"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
