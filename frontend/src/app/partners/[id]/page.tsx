'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { partners as partnersApi } from '@/lib/api';
import PartnerTagChip from '@/components/crm/PartnerTagChip';
import ContactLogEntry from '@/components/crm/ContactLogEntry';
import PartnerForm from '@/components/crm/PartnerForm';

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
  updated_at?: string;
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
  user_id?: string;
}

interface GrantLink {
  id: string;
  entity_type: string;
  entity_id: string;
  relationship: string;
  notes?: string;
  created_at?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  prospect: 'bg-yellow-100 text-yellow-800',
  inactive: 'bg-gray-100 text-gray-500',
};

const RELATIONSHIP_OPTIONS = [
  'PI', 'co-I', 'collaborator', 'funder_contact', 'reviewer',
  'advisor', 'industry_partner', 'ngo_partner', 'government_partner', 'other',
];

const UPDATE_TYPES = ['note', 'email', 'call', 'meeting', 'other'];

function formatDate(d?: string | null) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) fetchPartner();
  }, [id]);

  async function handleEditSave(data: Record<string, unknown>) {
    await partnersApi.update(id, data);
    setEditMode(false);
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
      setLogContent('');
      setLogType('note');
      setLogContactDate('');
      setLogNextContact('');
      setShowLogForm(false);
      fetchPartner();
    } finally {
      setLogSaving(false);
    }
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
      setLinkEntityId('');
      setLinkNotes('');
      setShowLinkForm(false);
      fetchPartner();
    } finally {
      setLinkSaving(false);
    }
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
    } finally {
      setSavingNotes(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20 text-gray-400 text-sm">Loading…</div>;
  }
  if (!partner) {
    return (
      <div className="p-8 text-center text-gray-500">
        Partner not found. <Link href="/partners" className="text-blue-600 hover:underline">Back to Partners</Link>
      </div>
    );
  }

  const latestNextContact = partner.updates
    .filter(u => u.next_contact_date)
    .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())[0]
    ?.next_contact_date;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-4">
        <Link href="/partners" className="hover:text-blue-600">Partners</Link>
        <span className="mx-2">›</span>
        <span className="text-gray-700">{partner.name}</span>
      </div>

      {/* Edit modal */}
      {editMode && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Edit Partner</h2>
              <button onClick={() => setEditMode(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-4">
              <PartnerForm
                initial={{
                  name: partner.name, email: partner.email ?? '', phone: partner.phone ?? '',
                  organization: partner.organization ?? '', title: partner.title ?? '',
                  linkedin_url: partner.linkedin_url ?? '', website: partner.website ?? '',
                  tags: partner.tags, project_types: partner.project_types,
                  status: partner.status, notes: partner.notes ?? '',
                }}
                onSubmit={handleEditSave}
                onCancel={() => setEditMode(false)}
                submitLabel="Save Changes"
              />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── LEFT: Contact card ─────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{partner.name}</h1>
                {partner.organization && (
                  <div className="text-sm text-gray-600 mt-0.5">{partner.organization}</div>
                )}
                {partner.title && (
                  <div className="text-xs text-gray-400">{partner.title}</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[partner.status] ?? STATUS_COLORS.active}`}>
                  {partner.status}
                </span>
                <button onClick={() => setEditMode(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50">
                  Edit
                </button>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {partner.email && (
                <div className="flex items-center gap-2 text-gray-700">
                  <span className="text-gray-400 w-5">✉</span>
                  <a href={`mailto:${partner.email}`} className="hover:text-blue-600 truncate">{partner.email}</a>
                </div>
              )}
              {partner.phone && (
                <div className="flex items-center gap-2 text-gray-700">
                  <span className="text-gray-400 w-5">📞</span>
                  <a href={`tel:${partner.phone}`} className="hover:text-blue-600">{partner.phone}</a>
                </div>
              )}
              {partner.linkedin_url && (
                <div className="flex items-center gap-2 text-gray-700">
                  <span className="text-gray-400 w-5">🔗</span>
                  <a href={partner.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="hover:text-blue-600 truncate text-xs">LinkedIn</a>
                </div>
              )}
              {partner.website && (
                <div className="flex items-center gap-2 text-gray-700">
                  <span className="text-gray-400 w-5">🌐</span>
                  <a href={partner.website} target="_blank" rel="noopener noreferrer"
                    className="hover:text-blue-600 truncate text-xs">{partner.website}</a>
                </div>
              )}
            </div>

            {latestNextContact && (
              <div className={`mt-4 text-xs font-medium flex items-center gap-1.5 p-2 rounded-lg ${
                isOverdue(latestNextContact) ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
              }`}>
                <span>📅</span>
                <span>
                  {isOverdue(latestNextContact) ? 'Overdue follow-up: ' : 'Next contact: '}
                  {formatDate(latestNextContact)}
                </span>
              </div>
            )}

            {/* Tags */}
            {partner.tags.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium text-gray-500 mb-1.5">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {partner.tags.map(t => <PartnerTagChip key={t} tag={t} />)}
                </div>
              </div>
            )}

            {/* Project types */}
            {partner.project_types.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-gray-500 mb-1.5">Project Types</div>
                <div className="flex flex-wrap gap-1">
                  {partner.project_types.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">{t}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
              Added {formatDate(partner.created_at)}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
            </div>
            <textarea
              className="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={5}
              value={notesEdit}
              onChange={e => setNotesEdit(e.target.value)}
              placeholder="Add notes about this partner…"
            />
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes || notesEdit === (partner.notes ?? '')}
              className="mt-2 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40"
            >
              {savingNotes ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        </div>

        {/* ── CENTER: Contact log ────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Contact Log</h2>
              <button
                onClick={() => setShowLogForm(!showLogForm)}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50"
              >
                {showLogForm ? 'Cancel' : '+ Log Contact'}
              </button>
            </div>

            {showLogForm && (
              <form onSubmit={handleLogSubmit} className="mb-4 border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                    <select value={logType} onChange={e => setLogType(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {UPDATE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Contact Date</label>
                    <input type="datetime-local" value={logContactDate} onChange={e => setLogContactDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes *</label>
                  <textarea
                    value={logContent}
                    onChange={e => setLogContent(e.target.value)}
                    required
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="What was discussed or noted…"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Next Contact Date</label>
                  <input type="datetime-local" value={logNextContact} onChange={e => setLogNextContact(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowLogForm(false)}
                    className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 text-gray-600">Cancel</button>
                  <button type="submit" disabled={logSaving}
                    className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                    {logSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            )}

            {partner.updates.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No contact log entries yet.</div>
            ) : (
              <div className="space-y-3">
                {partner.updates.map(u => (
                  <ContactLogEntry key={u.id} update={u} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Linked grants ───────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                Linked Grants & Opportunities
              </h2>
              <button
                onClick={() => setShowLinkForm(!showLinkForm)}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50"
              >
                {showLinkForm ? 'Cancel' : '+ Link'}
              </button>
            </div>

            {showLinkForm && (
              <form onSubmit={handleLinkSubmit} className="mb-4 border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={linkEntityType} onChange={e => setLinkEntityType(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="opportunity">Opportunity</option>
                    <option value="grant">Active Grant</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Grant / Opportunity ID *</label>
                  <input
                    value={linkEntityId}
                    onChange={e => setLinkEntityId(e.target.value)}
                    required
                    placeholder="Paste the ID from the grant or opportunity"
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
                  <select value={linkRelationship} onChange={e => setLinkRelationship(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {RELATIONSHIP_OPTIONS.map(r => (
                      <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <input
                    value={linkNotes}
                    onChange={e => setLinkNotes(e.target.value)}
                    placeholder="Optional context…"
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowLinkForm(false)}
                    className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 text-gray-600">Cancel</button>
                  <button type="submit" disabled={linkSaving}
                    className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                    {linkSaving ? 'Linking…' : 'Link'}
                  </button>
                </div>
              </form>
            )}

            {partner.grant_links.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No linked grants yet.</div>
            ) : (
              <div className="space-y-2">
                {partner.grant_links.map(lnk => (
                  <div key={lnk.id} className="border border-gray-200 rounded-xl p-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-gray-500 uppercase">
                          {lnk.entity_type}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                          {lnk.relationship.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <Link href={`/${lnk.entity_type === 'grant' ? 'grants' : 'opportunities'}/${lnk.entity_id}`}
                        className="text-sm text-blue-600 hover:underline font-mono truncate block">
                        {lnk.entity_id}
                      </Link>
                      {lnk.notes && (
                        <div className="text-xs text-gray-500 mt-1 truncate">{lnk.notes}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveLink(lnk.id)}
                      className="shrink-0 text-gray-300 hover:text-red-500 text-lg leading-none"
                      title="Remove link"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 bg-gray-50 rounded-xl">
                <div className="text-2xl font-bold text-gray-900">{partner.updates.length}</div>
                <div className="text-xs text-gray-500 mt-0.5">Log entries</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-xl">
                <div className="text-2xl font-bold text-gray-900">{partner.grant_links.length}</div>
                <div className="text-xs text-gray-500 mt-0.5">Grants linked</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
