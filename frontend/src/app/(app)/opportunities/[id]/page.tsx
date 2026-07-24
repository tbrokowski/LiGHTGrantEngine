'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, Check, AlertTriangle, Folder, ChevronLeft, ChevronRight, Loader2, Pencil } from 'lucide-react';
import { opportunities, ai, api, partners as partnersApi, funderOrgs as funderOrgsApi } from '@/lib/api';
import { notifyOpportunitiesChanged } from '@/lib/opportunities-events';
import { usePdfViewer } from '@/contexts/PdfViewerContext';
import { useAuth } from '@/lib/auth';
import FunderLogo from '@/components/opportunities/FunderLogo';
import OpportunityPlan from '@/components/opportunities/OpportunityPlan';
import BookmarkButton from '@/components/opportunities/BookmarkButton';
import ProseContent from '@/components/ui/ProseContent';

interface OpportunityDetail {
  id: string;
  title: string;
  funder?: string;
  program_name?: string;
  opportunity_url?: string;
  description?: string;
  ai_summary?: string;
  short_summary?: string;
  parsed_text?: string;
  deadline?: string;
  loi_deadline?: string;
  award_min?: number;
  award_max?: number;
  currency?: string;
  fit_score?: number;
  priority?: string;
  status?: string;
  is_read?: boolean;
  thematic_areas?: string[];
  geography?: string[];
  eligibility_criteria?: string;
  partner_requirements?: string;
  submission_portal?: string;
  evaluation_criteria?: string;
  required_documents?: string[];
  cost_sharing_requirements?: string;
  indirect_cost_rules?: string;
  project_duration?: string;
  expected_awards?: number;
  contact_information?: string;
  fit_rationale?: string;
  notes?: string;
  date_discovered?: string;
  funder_logo_url?: string;
  guidance_doc_link?: string;
  documents?: OpportunityDocument[];
  is_personal_shortlisted?: boolean;
  is_on_org_shortlist?: boolean;
  outcome?: 'awarded' | 'declined' | 'not_pursued' | null;
  outcome_recorded_at?: string | null;
  funder_org_id?: string | null;
}

interface OpportunityDocument {
  id: string;
  file_name?: string;
  file_url?: string;
  document_type?: string;
  processing_status?: string;
}

interface DeepReviewResult {
  fit_score: number;
  priority: string;
  verdict: string;
  score_breakdown: Record<string, number>;
  strengths: string[];
  risks: string[];
  proposal_strategy: string;
  critical_requirements: string[];
  archive_references: string[];
  go_no_go: 'GO' | 'NO-GO' | 'CONDITIONAL GO';
  go_no_go_rationale: string;
  recommended_sections: string[];
}

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High Fit',
  medium: 'Medium Fit',
  low: 'Low Fit',
  // legacy fallbacks
  high_priority: 'High Fit',
  worth_reviewing: 'Medium Fit',
  watchlist: 'Low Fit',
  low_fit: 'Low Fit',
};

const PRIORITY_STYLES: Record<string, string> = {
  high: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  medium: 'text-amber-700 bg-amber-50 border-amber-100',
  low: 'text-gray-500 bg-gray-100 border-gray-200',
  // legacy fallbacks
  high_priority: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  worth_reviewing: 'text-amber-700 bg-amber-50 border-amber-100',
  watchlist: 'text-sky-700 bg-sky-50 border-sky-100',
  low_fit: 'text-gray-500 bg-gray-100 border-gray-200',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

/** Collapsible section panel */
function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h3>
          {badge && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{badge}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-0 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}

const oppCache = new Map<string, OpportunityDetail>();

/** Parse a markdown string with ## headings into a section-name → body map */
function parseAiSections(md: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = md.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n');
    if (newline === -1) continue;
    const heading = part.slice(0, newline).trim();
    const body = part.slice(newline + 1).trim();
    if (heading && body) sections[heading] = body;
  }
  return sections;
}

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrapedOpen, setScrapedOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [deepReview, setDeepReview] = useState<DeepReviewResult | null>(null);
  const [converting, setConverting] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMessage, setEnrichMessage] = useState('');
  const [navIds, setNavIds] = useState<string[]>([]);
  const { openPdfViewer } = usePdfViewer();

  interface LinkedPartner {
    link_id: string;
    partner_id: string;
    partner_name: string;
    partner_organization: string | null;
    relationship: string;
  }
  const [linkedPartners, setLinkedPartners] = useState<LinkedPartner[]>([]);
  const [showPartnerPicker, setShowPartnerPicker] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerResults, setPartnerResults] = useState<{ id: string; name: string; organization: string | null }[]>([]);
  const [linkingBusy, setLinkingBusy] = useState(false);

  const fetchLinkedPartners = useCallback(() => {
    if (!id) return;
    opportunities.linkedPartners(id).then(r => setLinkedPartners(r.data)).catch(() => setLinkedPartners([]));
  }, [id]);

  useEffect(() => { fetchLinkedPartners(); }, [fetchLinkedPartners]);

  useEffect(() => {
    if (!showPartnerPicker || !partnerSearch.trim()) { setPartnerResults([]); return; }
    const t = setTimeout(() => {
      partnersApi.list({ q: partnerSearch })
        .then(r => setPartnerResults((r.data ?? []).slice(0, 8)))
        .catch(() => setPartnerResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [partnerSearch, showPartnerPicker]);

  async function handleLinkPartner(partnerId: string) {
    setLinkingBusy(true);
    try {
      await partnersApi.addLink(partnerId, { entity_type: 'opportunity', entity_id: id, relationship: 'funder_contact' });
      setPartnerSearch('');
      setPartnerResults([]);
      setShowPartnerPicker(false);
      fetchLinkedPartners();
    } finally {
      setLinkingBusy(false);
    }
  }

  async function handleUnlinkPartner(partnerId: string, linkId: string) {
    await partnersApi.deleteLink(partnerId, linkId);
    setLinkedPartners(prev => prev.filter(l => l.link_id !== linkId));
  }

  // ── Inline header editing (title / funder / deadline) ──────────────────────
  const [editingHeader, setEditingHeader] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editFunder, setEditFunder] = useState('');
  const [editDeadline, setEditDeadline] = useState('');
  const [savingHeader, setSavingHeader] = useState(false);

  function startEditHeader() {
    if (!opp) return;
    setEditTitle(opp.title ?? '');
    setEditFunder(opp.funder ?? '');
    setEditDeadline(opp.deadline ? opp.deadline.slice(0, 10) : '');
    setEditingHeader(true);
  }

  async function handleSaveHeader() {
    if (!opp) return;
    setSavingHeader(true);
    try {
      const payload: Record<string, unknown> = {
        title: editTitle.trim(),
        funder: editFunder.trim() || null,
      };
      if (editDeadline) payload.deadline = editDeadline;
      const res = await opportunities.update(id, payload);
      setOpp(prev => prev ? { ...prev, ...res.data } : prev);
      setEditingHeader(false);
      notifyOpportunitiesChanged();
    } finally {
      setSavingHeader(false);
    }
  }

  // ── Funder Org (the funding body — distinct from linked contacts above) ────
  interface FunderOrgDetail {
    id: string;
    name: string;
    url: string | null;
    notes: string | null;
    deadline_info: string | null;
  }
  const [funderOrg, setFunderOrg] = useState<FunderOrgDetail | null>(null);
  const [showFunderOrgPicker, setShowFunderOrgPicker] = useState(false);
  const [funderOrgSearch, setFunderOrgSearch] = useState('');
  const [funderOrgResults, setFunderOrgResults] = useState<{ id: string; name: string }[]>([]);
  const [editingFunderOrg, setEditingFunderOrg] = useState(false);
  const [funderOrgDraft, setFunderOrgDraft] = useState<Partial<FunderOrgDetail>>({});
  const [funderOrgBusy, setFunderOrgBusy] = useState(false);

  useEffect(() => {
    if (opp?.funder_org_id) {
      funderOrgsApi.get(opp.funder_org_id).then(r => setFunderOrg(r.data)).catch(() => setFunderOrg(null));
    } else {
      setFunderOrg(null);
    }
  }, [opp?.funder_org_id]);

  useEffect(() => {
    if (!showFunderOrgPicker || !funderOrgSearch.trim()) { setFunderOrgResults([]); return; }
    const t = setTimeout(() => {
      funderOrgsApi.list(funderOrgSearch)
        .then(r => setFunderOrgResults((r.data ?? []).slice(0, 8)))
        .catch(() => setFunderOrgResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [funderOrgSearch, showFunderOrgPicker]);

  async function handleAttachFunderOrg(funderOrgId: string) {
    setFunderOrgBusy(true);
    try {
      await opportunities.update(id, { funder_org_id: funderOrgId });
      setOpp(prev => prev ? { ...prev, funder_org_id: funderOrgId } : prev);
      setShowFunderOrgPicker(false);
      setFunderOrgSearch('');
      setFunderOrgResults([]);
    } finally {
      setFunderOrgBusy(false);
    }
  }

  function startEditFunderOrg() {
    if (!funderOrg) return;
    setFunderOrgDraft({ name: funderOrg.name, url: funderOrg.url ?? '', deadline_info: funderOrg.deadline_info ?? '' });
    setEditingFunderOrg(true);
  }

  async function handleSaveFunderOrg() {
    if (!funderOrg) return;
    setFunderOrgBusy(true);
    try {
      const res = await funderOrgsApi.update(funderOrg.id, funderOrgDraft);
      setFunderOrg(res.data);
      setEditingFunderOrg(false);
    } finally {
      setFunderOrgBusy(false);
    }
  }

  const fetchOpp = useCallback((notify = false) => {
    if (!id) return;
    // Serve cached version immediately so prefetched navigations feel instant
    if (oppCache.has(id)) {
      setOpp(oppCache.get(id)!);
      setLoading(false);
    }
    opportunities.get(id)
      .then(r => {
        oppCache.set(id, r.data);
        setOpp(r.data);
        if (notify) notifyOpportunitiesChanged();
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchOpp(true); }, [fetchOpp]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('opp_nav_list');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setNavIds(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  // Prefetch adjacent opportunities so arrow navigation feels instant
  useEffect(() => {
    if (!navIds.length || loading) return;
    const navIndex = navIds.indexOf(id);
    [navIds[navIndex - 1], navIds[navIndex + 1]]
      .filter(Boolean)
      .forEach(adjId => {
        if (!oppCache.has(adjId)) {
          opportunities.get(adjId)
            .then(r => oppCache.set(adjId, r.data))
            .catch(() => {});
        }
      });
  }, [id, navIds, loading]);

  // Poll for updated content after a re-enrich task is queued
  useEffect(() => {
    if (!enriching || !id) return;
    const prevDescription = opp?.description;
    const prevSummary = opp?.ai_summary;
    const interval = setInterval(async () => {
      try {
        const r = await opportunities.get(id);
        const fresh = r.data as OpportunityDetail;
        if (
          (fresh.description && fresh.description !== prevDescription) ||
          (fresh.ai_summary && fresh.ai_summary !== prevSummary)
        ) {
          setOpp(fresh);
          setEnriching(false);
          setEnrichMessage('');
        }
      } catch { /* silent */ }
    }, 5000);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setEnriching(false);
      setEnrichMessage('Content generation is taking longer than expected. Try again in a few minutes.');
    }, 120_000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriching, id]);

  async function handleDeepReview() {
    setReviewing(true);
    setActiveTab('ai');
    try {
      const res = await ai.deepReview(id);
      setDeepReview(res.data as DeepReviewResult);
      setOpp(prev => prev
        ? { ...prev, fit_score: res.data.fit_score, priority: res.data.priority, fit_rationale: res.data.verdict }
        : prev
      );
    } catch {
      alert('Deep review failed. Please try again.');
    } finally {
      setReviewing(false);
    }
  }

  async function handleRefresh() {
    setRefetching(true);
    try {
      await fetchOpp();
    } finally {
      setRefetching(false);
    }
  }

  async function handleReEnrich() {
    setRefetching(true);
    try {
      await api.post(`/opportunities/${id}/re-enrich`);
      setEnriching(true);
      setEnrichMessage('Re-enrichment queued — this usually takes 20–60 seconds…');
    } catch {
      setEnrichMessage('Failed to queue re-enrichment. Please try again.');
    } finally {
      setRefetching(false);
    }
  }

  async function handleDownloadDocument(docId: string, fileName?: string) {
    await openPdfViewer(docId, fileName);
  }

  async function handleConvert() {
    if (!confirm('Convert this opportunity to an active grant workspace?')) return;
    setConverting(true);
    try {
      const res = await opportunities.convertToGrant(id);
      router.push(`/grants/${res.data.grant_id}`);
    } catch {
      alert('Failed to start grant workspace. Please try again.');
    } finally {
      setConverting(false);
    }
  }

  async function handleToggleBookmark() {
    if (!opp) return;
    const isBookmarked = !!(opp.is_personal_shortlisted ?? opp.status === 'potential_fit');
    setActionBusy(true);
    try {
      if (isBookmarked) {
        await opportunities.removeFromShortlist(id);
        setOpp(prev => prev ? { ...prev, is_personal_shortlisted: false } : prev);
      } else {
        await opportunities.addToShortlist(id);
        setOpp(prev => prev ? { ...prev, is_personal_shortlisted: true, is_read: true } : prev);
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSetOutcome(outcome: string) {
    if (!opp) return;
    const next = outcome === '' ? null : outcome;
    setActionBusy(true);
    try {
      const res = await opportunities.setOutcome(id, next);
      setOpp(prev => prev ? { ...prev, outcome: res.data.outcome, outcome_recorded_at: res.data.outcome_recorded_at } : prev);
      notifyOpportunitiesChanged();
    } finally {
      setActionBusy(false);
    }
  }

  const isShortlisted = !!(opp?.is_personal_shortlisted ?? opp?.status === 'potential_fit');

  if (loading) {
    return <div className="flex justify-center py-24 text-sm text-gray-400">Loading...</div>;
  }
  if (!opp) {
    return (
      <div className="px-8 py-16 text-center text-gray-500 text-sm">
        Opportunity not found.{' '}
        <Link href="/opportunities" className="text-blue-600 hover:underline">Back to queue</Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="px-8 py-8 max-w-5xl mx-auto">
      {/* Breadcrumb + nav arrows */}
      {(() => {
        const navIndex = navIds.indexOf(id);
        const hasPrev = navIndex > 0;
        const hasNext = navIndex >= 0 && navIndex < navIds.length - 1;
        return (
          <div className="text-sm text-gray-400 mb-6 flex items-center gap-2">
            <Link href="/opportunities" className="hover:text-gray-700">Opportunities</Link>
            <span>/</span>
            <span className="text-gray-600 truncate">{opp.title}</span>
            {(hasPrev || hasNext) && (
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <button
                  onClick={() => router.push(`/opportunities/${navIds[navIndex - 1]}`)}
                  disabled={!hasPrev}
                  title="Previous opportunity"
                  className="p-1 rounded transition-colors disabled:opacity-30"
                  style={{ color: 'var(--ink-muted)' }}
                  onMouseEnter={e => { if (hasPrev) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  {navIndex + 1} / {navIds.length}
                </span>
                <button
                  onClick={() => router.push(`/opportunities/${navIds[navIndex + 1]}`)}
                  disabled={!hasNext}
                  title="Next opportunity"
                  className="p-1 rounded transition-colors disabled:opacity-30"
                  style={{ color: 'var(--ink-muted)' }}
                  onMouseEnter={e => { if (hasNext) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Inline enrichment status banner */}
      {enrichMessage && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm border ${
          enriching
            ? 'bg-amber-50 border-amber-100 text-amber-800'
            : 'bg-red-50 border-red-100 text-red-700'
        }`}>
          {enriching && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          {enrichMessage}
        </div>
      )}

      {/* Header card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between gap-6 mb-5">
          <div className="min-w-0 flex-1">
            {editingHeader ? (
              <div className="space-y-2">
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-xl font-semibold text-gray-900 border border-gray-300 rounded-md px-2 py-1"
                  placeholder="Title"
                />
                <div className="flex gap-2">
                  <input
                    value={editFunder}
                    onChange={e => setEditFunder(e.target.value)}
                    className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1"
                    placeholder="Funder"
                  />
                  <input
                    type="date"
                    value={editDeadline}
                    onChange={e => setEditDeadline(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveHeader}
                    disabled={!editTitle.trim() || savingHeader}
                    className="text-xs px-3 py-1.5 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingHeader ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingHeader(false)}
                    disabled={savingHeader}
                    className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <h1 className="text-xl font-semibold text-gray-900 leading-tight">{opp.title}</h1>
                  <button
                    onClick={startEditHeader}
                    title="Edit title, funder, deadline"
                    className="shrink-0 mt-1 text-gray-300 hover:text-gray-600 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-sm text-gray-500 mt-1.5 flex items-center gap-2 flex-wrap">
                  <FunderLogo url={opp.funder_logo_url} name={opp.funder} size="md" />
                  {opp.funder && <span className="font-medium text-gray-700">{opp.funder}</span>}
                  {opp.program_name && <><span className="text-gray-300">·</span><span>{opp.program_name}</span></>}
                </div>
              </>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            {opp.priority && (
              <span className={`text-xs px-2.5 py-1 rounded border font-medium ${PRIORITY_STYLES[opp.priority] ?? 'text-gray-500 bg-gray-100 border-gray-200'}`}>
                {PRIORITY_LABELS[opp.priority] ?? opp.priority.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {opp.deadline && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Deadline</div>
              <div className="text-sm font-medium text-gray-800">{formatDate(opp.deadline)}</div>
            </div>
          )}
          {opp.loi_deadline && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">LOI deadline</div>
              <div className="text-sm font-medium text-gray-800">{formatDate(opp.loi_deadline)}</div>
            </div>
          )}
          {(opp.award_min || opp.award_max) && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Award</div>
              <div className="text-sm font-medium text-gray-800">
                {opp.currency} {(opp.award_max ?? opp.award_min)?.toLocaleString()}
              </div>
            </div>
          )}
          {opp.project_duration && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Duration</div>
              <div className="text-sm font-medium text-gray-800">{opp.project_duration}</div>
            </div>
          )}
          {opp.expected_awards != null && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Expected awards</div>
              <div className="text-sm font-medium text-gray-800">{opp.expected_awards}</div>
            </div>
          )}
          {opp.status && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Status</div>
              <div className="text-sm font-medium text-gray-800 capitalize">{opp.status.replace(/_/g, ' ')}</div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-5 pt-5 border-t border-gray-100">
          <BookmarkButton
            isBookmarked={isShortlisted}
            onToggle={handleToggleBookmark}
            busy={actionBusy}
            size="md"
          />
          {opp.opportunity_url && (
            <a
              href={opp.opportunity_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-700 border border-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
            >
              View call ↗
            </a>
          )}
          <button
            onClick={handleDeepReview}
            disabled={reviewing}
            className="text-sm text-purple-700 border border-purple-200 bg-purple-50 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {reviewing ? (
            <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing...</span>
          ) : (
            <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Deep Review</span>
          )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refetching || enriching}
            className="text-sm text-gray-700 border border-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {refetching ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Refreshing…</span> : 'Refresh'}
          </button>
          {opp.opportunity_url && (
            <button
              onClick={handleReEnrich}
              disabled={refetching || enriching}
              className="text-sm text-amber-700 border border-amber-200 bg-amber-50 px-3 py-1.5 rounded-md hover:bg-amber-100 transition-colors disabled:opacity-50"
            >
              {enriching ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Re-enriching…</span> : 'Re-enrich'}
            </button>
          )}
          <select
            value={opp.outcome ?? ''}
            onChange={e => handleSetOutcome(e.target.value)}
            disabled={actionBusy}
            title="Record whether your organization won, declined, or didn't pursue this grant"
            className="text-sm border border-gray-300 rounded-md px-2.5 py-1.5 bg-white text-gray-700 disabled:opacity-50 ml-auto"
          >
            <option value="">No outcome recorded</option>
            <option value="awarded">Awarded</option>
            <option value="declined">Declined</option>
            <option value="not_pursued">Not pursued</option>
          </select>
          <button
            onClick={handleConvert}
            disabled={converting}
            className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 font-medium"
          >
            {converting ? 'Starting…' : '+ Start Grant'}
          </button>
        </div>

        {/* Funder Org — the funding body itself, distinct from the scraper portal */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Funder Org</span>
            <button
              onClick={() => setShowFunderOrgPicker(v => !v)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {showFunderOrgPicker ? 'Cancel' : funderOrg ? 'Change' : '+ Link funder org'}
            </button>
          </div>

          {funderOrg && !editingFunderOrg && (
            <div className="flex items-start justify-between gap-3 mb-2 p-2.5 bg-gray-50 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">{funderOrg.name}</p>
                {funderOrg.url && (
                  <a href={funderOrg.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block">
                    {funderOrg.url}
                  </a>
                )}
                {funderOrg.deadline_info && <p className="text-xs text-gray-500 mt-0.5">{funderOrg.deadline_info}</p>}
              </div>
              <button onClick={startEditFunderOrg} className="shrink-0 text-gray-400 hover:text-gray-700">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {editingFunderOrg && funderOrg && (
            <div className="mb-2 p-2.5 bg-gray-50 rounded-lg space-y-1.5">
              <input value={funderOrgDraft.name ?? ''} onChange={e => setFunderOrgDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" className="w-full text-sm border border-gray-300 rounded-md px-2 py-1" />
              <input value={funderOrgDraft.url ?? ''} onChange={e => setFunderOrgDraft(d => ({ ...d, url: e.target.value }))} placeholder="URL" className="w-full text-sm border border-gray-300 rounded-md px-2 py-1" />
              <input value={funderOrgDraft.deadline_info ?? ''} onChange={e => setFunderOrgDraft(d => ({ ...d, deadline_info: e.target.value }))} placeholder="Deadline info" className="w-full text-sm border border-gray-300 rounded-md px-2 py-1" />
              <div className="flex gap-2">
                <button onClick={handleSaveFunderOrg} disabled={funderOrgBusy} className="text-xs px-3 py-1.5 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                  {funderOrgBusy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingFunderOrg(false)} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-600">Cancel</button>
              </div>
            </div>
          )}

          {showFunderOrgPicker && (
            <div className="relative">
              <input
                autoFocus
                type="text"
                value={funderOrgSearch}
                onChange={e => setFunderOrgSearch(e.target.value)}
                placeholder="Search funder orgs by name…"
                className="w-full max-w-sm text-sm border border-gray-300 rounded-md px-2.5 py-1.5"
                disabled={funderOrgBusy}
              />
              {funderOrgResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-w-sm bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
                  {funderOrgResults.map(f => (
                    <button
                      key={f.id}
                      onClick={() => handleAttachFunderOrg(f.id)}
                      disabled={funderOrgBusy}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Linked Contacts */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Linked Contacts</span>
            <button
              onClick={() => setShowPartnerPicker(v => !v)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {showPartnerPicker ? 'Cancel' : '+ Link contact'}
            </button>
          </div>

          {linkedPartners.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {linkedPartners.map(lnk => (
                <span
                  key={lnk.link_id}
                  className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full pl-2.5 pr-1 py-1"
                >
                  <Link href={`/partners/${lnk.partner_id}`} className="hover:underline">
                    {lnk.partner_name}{lnk.partner_organization ? ` · ${lnk.partner_organization}` : ''}
                  </Link>
                  <button
                    onClick={() => handleUnlinkPartner(lnk.partner_id, lnk.link_id)}
                    className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-gray-300 text-gray-500"
                    title="Unlink"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {showPartnerPicker && (
            <div className="relative">
              <input
                autoFocus
                type="text"
                value={partnerSearch}
                onChange={e => setPartnerSearch(e.target.value)}
                placeholder="Search contacts by name…"
                className="w-full max-w-sm text-sm border border-gray-300 rounded-md px-2.5 py-1.5"
                disabled={linkingBusy}
              />
              {partnerResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-w-sm bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
                  {partnerResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleLinkPartner(p.id)}
                      disabled={linkingBusy}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {p.name}{p.organization ? ` · ${p.organization}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Plan: tasks, dates, reminders, notes, links ── */}
      <OpportunityPlan
        opportunityId={id}
        canUseOrg={!user?.institution_is_personal}
        defaultScope={opp.is_on_org_shortlist ? 'org' : 'user'}
        institutionId={user?.institution_id}
      />

      {/* ── Card 1: Call Overview ── */}
      {(() => {
        const isOrgUser = !user?.institution_is_personal;
        const aiSections = opp.ai_summary ? parseAiSections(opp.ai_summary) : {};
        const ALWAYS_SECTIONS = ['What This Grant Funds', 'Eligibility at a Glance', 'Key Dates', 'Budget & Award Details', 'Risk Flags'];
        const ORG_SECTIONS = ['Fit Assessment', 'Potential Projects to Propose'];
        const visibleSections = [...ALWAYS_SECTIONS, ...(isOrgUser ? ORG_SECTIONS : [])];
        const hasAnySections = visibleSections.some(s => aiSections[s]);

        return (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Call Overview</h2>
              {reviewing && (
                <span className="flex items-center gap-1.5 text-xs text-purple-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing…
                </span>
              )}
            </div>

            {!opp.ai_summary && !reviewing ? (
              <div className="px-5 py-10 text-center">
                <Sparkles className="w-6 h-6 text-purple-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 mb-4">
                  AI summary not yet generated for this opportunity.
                </p>
                <button
                  onClick={handleDeepReview}
                  disabled={reviewing}
                  className="text-sm text-white bg-purple-600 hover:bg-purple-700 px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 font-medium"
                >
                  <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Generate Overview</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visibleSections.map(sectionName => {
                  const body = aiSections[sectionName];
                  if (!body) return null;
                  return (
                    <div key={sectionName} className="px-5 py-4">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{sectionName}</h3>
                      <ProseContent content={body} />
                    </div>
                  );
                })}
                {!hasAnySections && opp.ai_summary && (
                  <div className="px-5 py-4">
                    <ProseContent content={opp.ai_summary} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Card 2: Deep Review (shown when run) ── */}
      {(reviewing || deepReview) && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" /> Deep Review
            </h2>
            {!reviewing && (
              <button
                onClick={handleDeepReview}
                disabled={reviewing}
                className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-purple-600 transition-colors disabled:opacity-50"
              >
                Re-run <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {reviewing && (
            <div className="px-5 py-8 text-center text-sm text-purple-600 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Running deep analysis — this takes 10–20 seconds…
            </div>
          )}

          {deepReview && !reviewing && (
            <div className="space-y-4 p-5">
              {/* Verdict banner */}
              <div className={`rounded-lg p-5 border ${
                deepReview.go_no_go === 'GO'
                  ? 'bg-green-50 border-green-200'
                  : deepReview.go_no_go === 'CONDITIONAL GO'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${
                    deepReview.go_no_go === 'GO'
                      ? 'bg-green-600 text-white'
                      : deepReview.go_no_go === 'CONDITIONAL GO'
                      ? 'bg-amber-600 text-white'
                      : 'bg-red-600 text-white'
                  }`}>
                    {deepReview.go_no_go}
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded border ${PRIORITY_STYLES[deepReview.priority] ?? 'text-gray-500 bg-gray-100 border-gray-200'}`}>
                    {PRIORITY_LABELS[deepReview.priority] ?? deepReview.priority}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-800 mt-1">{deepReview.verdict}</p>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">{deepReview.go_no_go_rationale}</p>
              </div>

              {/* Strengths + Risks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(deepReview.strengths ?? []).length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> Strengths
                    </h3>
                    <ul className="space-y-1.5">
                      {deepReview.strengths.map((s, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-green-400 shrink-0 mt-0.5">•</span><span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(deepReview.risks ?? []).length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> Risks
                    </h3>
                    <ul className="space-y-1.5">
                      {deepReview.risks.map((r, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-amber-400 shrink-0 mt-0.5">•</span><span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {deepReview.proposal_strategy && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Proposal Strategy</h3>
                  <p className="text-sm text-blue-900 leading-relaxed">{deepReview.proposal_strategy}</p>
                </div>
              )}

              {(deepReview.critical_requirements ?? []).length > 0 && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Critical Requirements</h3>
                  <ul className="space-y-1.5">
                    {deepReview.critical_requirements.map((req, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" className="mt-0.5 rounded" readOnly />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(deepReview.recommended_sections ?? []).length > 0 && (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recommended Sections</h3>
                    <ul className="space-y-1">
                      {deepReview.recommended_sections.map((s, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-blue-400 shrink-0">→</span><span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(deepReview.archive_references ?? []).length > 0 && (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Archive References</h3>
                    <ul className="space-y-1">
                      {deepReview.archive_references.map((ref, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-2">
                          <Folder className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" /><span>{ref}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Card 3: Scraped Call (collapsible) ── */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setScrapedOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
        >
          <h2 className="text-sm font-semibold text-gray-800">Scraped Call</h2>
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${scrapedOpen ? 'rotate-90' : ''}`} />
        </button>

        {scrapedOpen && (
          <div className="border-t border-gray-100 px-5 py-5 space-y-4">
            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</h3>
                {!opp.description && opp.opportunity_url && (
                  <button
                    onClick={handleReEnrich}
                    disabled={refetching || enriching}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 flex items-center gap-0.5"
                  >
                    {enriching ? 'Queuing...' : <>Fetch from source <ChevronRight className="w-3 h-3" /></>}
                  </button>
                )}
              </div>
              {opp.description ? (
                <ProseContent content={opp.description} />
              ) : (
                <p className="text-sm text-gray-400 italic">
                  {opp.opportunity_url
                    ? 'Description not yet fetched.'
                    : 'No description available.'}
                </p>
              )}
            </div>

            {/* Call Documents */}
            {((opp.documents ?? []).length > 0 || opp.guidance_doc_link) && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Call Documents</h3>
                {(opp.documents ?? []).length > 0 ? (
                  <ul className="space-y-2">
                    {opp.documents!.map(doc => (
                      <li key={doc.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-700 truncate">{doc.file_name || 'Call document'}</span>
                        <button type="button" onClick={() => handleDownloadDocument(doc.id, doc.file_name)} className="shrink-0 text-blue-600 hover:text-blue-800 font-medium">
                          View PDF
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : opp.guidance_doc_link ? (
                  <a href={opp.guidance_doc_link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-800">
                    View call document on funder site
                  </a>
                ) : null}
              </div>
            )}

            {/* Thematic Areas */}
            {(opp.thematic_areas ?? []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Thematic Areas</h3>
                <div className="flex flex-wrap gap-1.5">
                  {opp.thematic_areas!.map(t => (
                    <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Geography */}
            {(opp.geography ?? []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Geography</h3>
                <div className="flex flex-wrap gap-1.5">
                  {opp.geography!.map(g => (
                    <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{g}</span>
                  ))}
                </div>
              </div>
            )}

            {opp.eligibility_criteria && (
              <CollapsibleSection title="Eligibility" defaultOpen={true}>
                <div className="pt-3"><ProseContent content={opp.eligibility_criteria} /></div>
              </CollapsibleSection>
            )}
            {opp.partner_requirements && (
              <CollapsibleSection title="Partner Requirements">
                <div className="pt-3"><ProseContent content={opp.partner_requirements} /></div>
              </CollapsibleSection>
            )}
            {opp.evaluation_criteria && (
              <CollapsibleSection title="Evaluation Criteria">
                <div className="pt-3"><ProseContent content={opp.evaluation_criteria} /></div>
              </CollapsibleSection>
            )}
            {(opp.submission_portal || opp.required_documents?.length || opp.cost_sharing_requirements || opp.indirect_cost_rules) && (
              <CollapsibleSection title="Submission Details">
                <div className="pt-3 space-y-3 text-sm text-gray-700">
                  {opp.submission_portal && (
                    <div>
                      <span className="font-medium text-gray-800">Submission portal: </span>
                      <a href={opp.submission_portal} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{opp.submission_portal}</a>
                    </div>
                  )}
                  {opp.required_documents && opp.required_documents.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-800 block mb-1">Required documents:</span>
                      <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                        {opp.required_documents.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                  {opp.cost_sharing_requirements && (
                    <div><span className="font-medium text-gray-800">Cost sharing: </span>{opp.cost_sharing_requirements}</div>
                  )}
                  {opp.indirect_cost_rules && (
                    <div><span className="font-medium text-gray-800">Indirect costs: </span>{opp.indirect_cost_rules}</div>
                  )}
                </div>
              </CollapsibleSection>
            )}
            {opp.contact_information && (
              <CollapsibleSection title="Contact Information">
                <div className="pt-3"><p className="text-sm text-gray-700 whitespace-pre-wrap">{opp.contact_information}</p></div>
              </CollapsibleSection>
            )}
            {opp.notes && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{opp.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
