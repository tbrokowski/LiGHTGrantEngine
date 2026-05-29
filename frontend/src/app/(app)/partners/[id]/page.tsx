'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { partners as partnersApi } from '@/lib/api';
import PartnerHero from '@/components/crm/PartnerHero';
import PartnerTimeline from '@/components/crm/PartnerTimeline';
import PartnerMeetingCard from '@/components/crm/PartnerMeetingCard';
import PartnerMeetingScheduler from '@/components/crm/PartnerMeetingScheduler';
import PartnerDocuments from '@/components/crm/PartnerDocuments';
import PartnerAIInsights from '@/components/crm/PartnerAIInsights';
import PartnerForm, { PartnerFormData } from '@/components/crm/PartnerForm';

interface PartnerDetail {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  organization_id?: string;
  title?: string;
  linkedin_url?: string;
  website?: string;
  tags: string[];
  project_types: string[];
  status: string;
  relationship_stage: string;
  notes?: string;
  avatar_url?: string;
  department?: string;
  country?: string;
  city?: string;
  orcid?: string;
  google_scholar_id?: string;
  h_index?: number;
  enrichment_status: string;
  last_enriched_at?: string;
  org_info?: { id: string; name: string; org_type: string } | null;
  updates: ContactUpdate[];
  grant_links: GrantLink[];
  meetings: Meeting[];
  documents: Document[];
  next_contact_date?: string;
  created_at?: string;
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
  created_at?: string;
}

interface Meeting {
  id: string;
  title: string;
  scheduled_at?: string;
  duration_minutes: number;
  location?: string;
  meeting_type: string;
  agenda: string[];
  notes?: string;
  action_items: { text: string; assignee_name?: string; done: boolean }[];
  attendees: { name: string; email?: string; is_internal?: boolean }[];
  meeting_prep?: string;
  meeting_prep_generated_at?: string;
  completed_at?: string;
}

interface Document {
  id: string;
  document_type: string;
  filename?: string;
  file_size?: number;
  expertise_extracted: { area: string; confidence: number; keywords?: string[] }[];
  created_at?: string;
}

type ActiveTab = 'timeline' | 'meetings' | 'research' | 'links' | 'insights' | 'edit';

const RELATIONSHIP_OPTIONS = [
  'PI', 'co-I', 'collaborator', 'funder_contact', 'reviewer',
  'advisor', 'industry_partner', 'ngo_partner', 'government_partner', 'other',
];

function formatDate(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('timeline');
  const [showMeetingScheduler, setShowMeetingScheduler] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkEntityType, setLinkEntityType] = useState('opportunity');
  const [linkEntityId, setLinkEntityId] = useState('');
  const [linkRelationship, setLinkRelationship] = useState('collaborator');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);

  const fetchPartner = useCallback(async () => {
    try {
      const res = await partnersApi.get(id);
      setPartner(res.data);
      setNotesValue(res.data.notes ?? '');
      setNotesDirty(false);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { if (id) fetchPartner(); }, [id, fetchPartner]);

  async function handleStageChange(stage: string) {
    if (!partner) return;
    await partnersApi.updateStage(partner.id, stage);
    setPartner(p => p ? { ...p, relationship_stage: stage } : p);
  }

  async function handleEditSave(data: PartnerFormData) {
    await partnersApi.update(id, data as unknown as Record<string, unknown>);
    setActiveTab('timeline');
    fetchPartner();
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    try {
      await partnersApi.update(id, { notes: notesValue });
      setNotesDirty(false);
    } finally { setNotesSaving(false); }
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

  if (loading) return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
  if (!partner) {
    return (
      <div className="px-8 py-16 text-center text-gray-500 text-sm">
        Partner not found.{' '}
        <Link href="/partners" className="text-blue-600 hover:underline">Back to partners</Link>
      </div>
    );
  }

  const upcomingMeetings = partner.meetings.filter(m => m.scheduled_at && !m.completed_at && new Date(m.scheduled_at) >= new Date());
  const pastMeetings = partner.meetings.filter(m => m.completed_at || (m.scheduled_at && new Date(m.scheduled_at) < new Date()));

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'timeline', label: `Timeline (${partner.updates.length})` },
    { key: 'meetings', label: `Meetings (${partner.meetings.length})` },
    { key: 'research', label: `Research & CV (${partner.documents.length})` },
    { key: 'links', label: `Grant Links (${partner.grant_links.length})` },
    { key: 'insights', label: 'AI Insights' },
    { key: 'edit', label: 'Edit' },
  ];

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-5 flex items-center gap-2">
        <Link href="/partners" className="hover:text-gray-700">Partners</Link>
        <span>/</span>
        <span className="text-gray-600">{partner.name}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
        {/* Left: Hero + Tabs */}
        <div className="space-y-4">
          <PartnerHero
            partner={partner}
            onEnrich={fetchPartner}
            onLogInteraction={() => setActiveTab('timeline')}
            onScheduleMeeting={() => setShowMeetingScheduler(true)}
            onDraftEmail={() => setActiveTab('insights')}
            onAddToGrant={() => { setActiveTab('links'); setShowLinkForm(true); }}
            onStageChange={handleStageChange}
          />

          {/* Tab bar */}
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
              {activeTab === 'timeline' && (
                <PartnerTimeline
                  partnerId={id}
                  updates={partner.updates}
                  onRefresh={fetchPartner}
                />
              )}

              {activeTab === 'meetings' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-900">Meetings</h2>
                    <button onClick={() => setShowMeetingScheduler(true)}
                      className="text-sm text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50">
                      + Schedule
                    </button>
                  </div>

                  {upcomingMeetings.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Upcoming</h3>
                      <div className="space-y-2">
                        {upcomingMeetings.map(m => (
                          <PartnerMeetingCard key={m.id} partnerId={id} meeting={m} onRefresh={fetchPartner} />
                        ))}
                      </div>
                    </div>
                  )}

                  {pastMeetings.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Past</h3>
                      <div className="space-y-2">
                        {pastMeetings.map(m => (
                          <PartnerMeetingCard key={m.id} partnerId={id} meeting={m} onRefresh={fetchPartner} />
                        ))}
                      </div>
                    </div>
                  )}

                  {partner.meetings.length === 0 && (
                    <div className="text-sm text-gray-400 text-center py-10">
                      No meetings yet.{' '}
                      <button onClick={() => setShowMeetingScheduler(true)} className="text-blue-600 hover:underline">
                        Schedule your first meeting
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'research' && (
                <div>
                  {/* ORCID / Scholar IDs */}
                  {(partner.orcid || partner.google_scholar_id) && (
                    <div className="flex flex-wrap gap-3 mb-4 text-xs">
                      {partner.orcid && (
                        <a href={`https://orcid.org/${partner.orcid}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-green-700 bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-lg hover:bg-green-100">
                          ORCID: {partner.orcid}
                        </a>
                      )}
                      {partner.google_scholar_id && (
                        <a href={`https://scholar.google.com/citations?user=${partner.google_scholar_id}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-lg hover:bg-blue-100">
                          Google Scholar
                        </a>
                      )}
                    </div>
                  )}
                  <PartnerDocuments
                    partnerId={id}
                    documents={partner.documents}
                    onRefresh={fetchPartner}
                  />
                </div>
              )}

              {activeTab === 'links' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-900">Linked grants and opportunities</h2>
                    <button onClick={() => setShowLinkForm(!showLinkForm)}
                      className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50">
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
                          placeholder="Paste the ID from the URL"
                          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                        <input value={linkNotes} onChange={e => setLinkNotes(e.target.value)}
                          placeholder="Context or role details"
                          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                                {lnk.relationship.replace(/_/g, ' ')}
                              </span>
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
                </div>
              )}

              {activeTab === 'insights' && (
                <PartnerAIInsights
                  partnerId={id}
                  partnerName={partner.name}
                  tags={partner.tags}
                  lastContact={partner.updates[0]?.contact_date || partner.updates[0]?.created_at}
                  nextContact={partner.next_contact_date}
                />
              )}

              {activeTab === 'edit' && (
                <PartnerForm
                  initial={{
                    name: partner.name,
                    email: partner.email ?? '',
                    phone: partner.phone ?? '',
                    organization: partner.organization ?? '',
                    title: partner.title ?? '',
                    linkedin_url: partner.linkedin_url ?? '',
                    website: partner.website ?? '',
                    tags: partner.tags,
                    project_types: partner.project_types,
                    status: partner.status,
                    notes: partner.notes ?? '',
                  }}
                  onSubmit={handleEditSave}
                  onCancel={() => setActiveTab('timeline')}
                  submitLabel="Save changes"
                />
              )}
            </div>
          </div>
        </div>

        {/* Right: Notes + Info */}
        <div className="space-y-4">
          {/* Notes */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
            <textarea
              rows={6}
              value={notesValue}
              onChange={e => { setNotesValue(e.target.value); setNotesDirty(true); }}
              placeholder="Free-form notes about this partner…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
            />
            {notesDirty && (
              <button onClick={handleSaveNotes} disabled={notesSaving}
                className="mt-2 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md disabled:opacity-40 hover:bg-blue-700">
                {notesSaving ? 'Saving…' : 'Save notes'}
              </button>
            )}
          </div>

          {/* Quick stats */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Overview</h3>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex justify-between">
                <span className="text-gray-400">Interactions</span>
                <span className="font-medium">{partner.updates.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Meetings</span>
                <span className="font-medium">{partner.meetings.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Linked grants</span>
                <span className="font-medium">{partner.grant_links.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Documents</span>
                <span className="font-medium">{partner.documents.length}</span>
              </div>
              {partner.next_contact_date && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Next follow-up</span>
                  <span className={`font-medium ${new Date(partner.next_contact_date) < new Date() ? 'text-red-600' : 'text-blue-700'}`}>
                    {formatDate(partner.next_contact_date)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Added</span>
                <span>{formatDate(partner.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Org info */}
          {partner.org_info && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Organization</h3>
              <p className="text-sm font-medium text-gray-800">{partner.org_info.name}</p>
              <p className="text-xs text-gray-400 capitalize mt-0.5">{partner.org_info.org_type?.replace(/_/g, ' ')}</p>
            </div>
          )}
        </div>
      </div>

      {showMeetingScheduler && (
        <PartnerMeetingScheduler
          partnerId={id}
          partnerName={partner.name}
          onClose={() => setShowMeetingScheduler(false)}
          onCreated={() => { setShowMeetingScheduler(false); setActiveTab('meetings'); fetchPartner(); }}
        />
      )}
    </div>
  );
}
