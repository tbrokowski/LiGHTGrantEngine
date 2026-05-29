'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, Check, AlertTriangle, Folder, ChevronRight, Loader2 } from 'lucide-react';
import { opportunities, ai, api } from '@/lib/api';
import { notifyOpportunitiesChanged } from '@/lib/opportunities-events';
import { usePdfViewer } from '@/contexts/PdfViewerContext';
import SuggestedPartners from '@/components/crm/SuggestedPartners';
import FunderLogo from '@/components/opportunities/FunderLogo';
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

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'partners'>('overview');
  const [reviewing, setReviewing] = useState(false);
  const [deepReview, setDeepReview] = useState<DeepReviewResult | null>(null);
  const [converting, setConverting] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMessage, setEnrichMessage] = useState('');
  const { openPdfViewer } = usePdfViewer();

  const fetchOpp = useCallback((notify = false) => {
    if (!id) return;
    opportunities.get(id)
      .then(r => {
        setOpp(r.data);
        if (notify) notifyOpportunitiesChanged();
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchOpp(true); }, [fetchOpp]);

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
    <div className="px-8 py-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-6 flex items-center gap-2">
        <Link href="/opportunities" className="hover:text-gray-700">Opportunities</Link>
        <span>/</span>
        <span className="text-gray-600 truncate">{opp.title}</span>
      </div>

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
            <h1 className="text-xl font-semibold text-gray-900 leading-tight">{opp.title}</h1>
            <div className="text-sm text-gray-500 mt-1.5 flex items-center gap-2 flex-wrap">
              <FunderLogo url={opp.funder_logo_url} name={opp.funder} size="md" />
              {opp.funder && <span className="font-medium text-gray-700">{opp.funder}</span>}
              {opp.program_name && <><span className="text-gray-300">·</span><span>{opp.program_name}</span></>}
            </div>
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
          <button
            onClick={handleConvert}
            disabled={converting}
            className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 ml-auto font-medium"
          >
            {converting ? 'Starting…' : '+ Start Grant'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-gray-200">
        {(['overview', 'ai', 'partners'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'ai'
              ? 'AI Review'
              : tab === 'partners' ? 'Partners' : 'Overview'}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          {/* Fit Rationale */}
          {opp.fit_rationale && (
            <div className={`rounded-lg px-4 py-3 border text-sm ${
              (opp.priority === 'high' || opp.priority === 'high_priority')
                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                : (opp.priority === 'medium' || opp.priority === 'worth_reviewing')
                ? 'bg-amber-50 border-amber-100 text-amber-800'
                : 'bg-gray-50 border-gray-200 text-gray-600'
            }`}>
              {opp.fit_rationale}
            </div>
          )}

          {/* Main Description */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</h3>
              {!opp.description && opp.opportunity_url && (
                <button
                  onClick={handleReEnrich}
                  disabled={refetching || enriching}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  <span className="flex items-center gap-0.5">{enriching ? 'Queuing...' : <>Fetch from source <ChevronRight className="w-3 h-3" /></>}</span>
                </button>
              )}
            </div>
            {opp.description ? (
              <ProseContent content={opp.description} />
            ) : (
              <div className="text-sm text-gray-400 italic py-2">
                {opp.opportunity_url
                  ? 'Description not yet fetched. Click "Fetch from source" or "Refresh description" to retrieve it.'
                  : 'No description available and no source URL to fetch from.'}
              </div>
            )}
          </div>

          {/* Call Documents */}
          {((opp.documents ?? []).length > 0 || opp.guidance_doc_link) && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Call Documents</h3>
              {(opp.documents ?? []).length > 0 ? (
                <ul className="space-y-2">
                  {opp.documents!.map(doc => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-gray-700 truncate">{doc.file_name || 'Call document'}</span>
                      <button
                        type="button"
                        onClick={() => handleDownloadDocument(doc.id, doc.file_name)}
                        className="shrink-0 text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View PDF
                      </button>
                    </li>
                  ))}
                </ul>
              ) : opp.guidance_doc_link ? (
                <a
                  href={opp.guidance_doc_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  View call document on funder site
                </a>
              ) : null}
            </div>
          )}

          {/* Thematic Areas */}
          {(opp.thematic_areas ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Thematic Areas</h3>
              <div className="flex flex-wrap gap-1.5">
                {opp.thematic_areas!.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Geography */}
          {(opp.geography ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Geography</h3>
              <div className="flex flex-wrap gap-1.5">
                {opp.geography!.map(g => (
                  <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{g}</span>
                ))}
              </div>
            </div>
          )}

          {/* Eligibility — collapsible */}
          {opp.eligibility_criteria && (
            <CollapsibleSection title="Eligibility" defaultOpen={true}>
              <div className="pt-3">
                <ProseContent content={opp.eligibility_criteria} />
              </div>
            </CollapsibleSection>
          )}

          {/* Partner Requirements — collapsible */}
          {opp.partner_requirements && (
            <CollapsibleSection title="Partner Requirements">
              <div className="pt-3">
                <ProseContent content={opp.partner_requirements} />
              </div>
            </CollapsibleSection>
          )}

          {/* Evaluation Criteria — collapsible */}
          {opp.evaluation_criteria && (
            <CollapsibleSection title="Evaluation Criteria">
              <div className="pt-3">
                <ProseContent content={opp.evaluation_criteria} />
              </div>
            </CollapsibleSection>
          )}

          {/* Submission Details — collapsible */}
          {(opp.submission_portal || opp.required_documents?.length || opp.cost_sharing_requirements || opp.indirect_cost_rules) && (
            <CollapsibleSection title="Submission Details">
              <div className="pt-3 space-y-3 text-sm text-gray-700">
                {opp.submission_portal && (
                  <div>
                    <span className="font-medium text-gray-800">Submission portal: </span>
                    <a href={opp.submission_portal} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                      {opp.submission_portal}
                    </a>
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
                  <div>
                    <span className="font-medium text-gray-800">Cost sharing: </span>
                    {opp.cost_sharing_requirements}
                  </div>
                )}
                {opp.indirect_cost_rules && (
                  <div>
                    <span className="font-medium text-gray-800">Indirect costs: </span>
                    {opp.indirect_cost_rules}
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Contact Info — collapsible */}
          {opp.contact_information && (
            <CollapsibleSection title="Contact Information">
              <div className="pt-3">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{opp.contact_information}</p>
              </div>
            </CollapsibleSection>
          )}

          {/* Notes */}
          {opp.notes && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{opp.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── AI Review Tab ── */}
      {activeTab === 'ai' && (
        <div className="space-y-4">
          {reviewing && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-6 text-center">
              <div className="inline-flex items-center gap-2 text-sm text-purple-700">
                <Loader2 className="w-4 h-4 animate-spin" />
                Running deep analysis — this takes 10–20 seconds...
              </div>
            </div>
          )}

          {!deepReview && !reviewing && (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
              <Sparkles className="w-7 h-7 text-purple-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-gray-800 mb-2">Deep AI Review</h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto mb-5">
                Get a comprehensive strategic assessment — fit score, strengths, risks, proposal strategy,
                critical requirements, and a Go / No-Go recommendation grounded in your org profile and past grants.
              </p>
              <button
                onClick={handleDeepReview}
                disabled={reviewing}
                className="text-sm text-white bg-purple-600 hover:bg-purple-700 px-5 py-2 rounded-md transition-colors disabled:opacity-50 font-medium"
              >
                Run Deep Review
              </button>
              {opp.ai_summary && (
                <div className="mt-8 text-left border-t border-gray-100 pt-6">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">AI Summary</h4>
                  <ProseContent content={opp.ai_summary} />
                </div>
              )}
            </div>
          )}

          {deepReview && !reviewing && (
            <>
              {/* Verdict banner */}
              <div className={`rounded-lg p-5 border ${
                deepReview.go_no_go === 'GO'
                  ? 'bg-green-50 border-green-200'
                  : deepReview.go_no_go === 'CONDITIONAL GO'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-start gap-4">
                  <div>
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
                </div>
              </div>

              {/* Strengths + Risks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(deepReview.strengths ?? []).length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> Strengths
                    </h3>
                    <ul className="space-y-1.5">
                      {deepReview.strengths!.map((s, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-green-400 shrink-0 mt-0.5">•</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(deepReview.risks ?? []).length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" /> Risks
                    </h3>
                    <ul className="space-y-1.5">
                      {deepReview.risks!.map((r, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-amber-400 shrink-0 mt-0.5">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Proposal strategy */}
              {deepReview.proposal_strategy && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-5">
                  <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Proposal Strategy</h3>
                  <p className="text-sm text-blue-900 leading-relaxed">{deepReview.proposal_strategy}</p>
                </div>
              )}

              {/* Critical requirements */}
              {(deepReview.critical_requirements ?? []).length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Critical Requirements</h3>
                  <ul className="space-y-1.5">
                    {deepReview.critical_requirements!.map((req, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" className="mt-0.5 rounded" readOnly />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommended sections + archive references */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(deepReview.recommended_sections ?? []).length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recommended Sections</h3>
                    <ul className="space-y-1">
                      {deepReview.recommended_sections!.map((s, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2">
                          <span className="text-blue-400 shrink-0">→</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(deepReview.archive_references ?? []).length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Archive References</h3>
                    <ul className="space-y-1">
                      {deepReview.archive_references!.map((ref, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-2">
                          <Folder className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
                          <span>{ref}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Re-run */}
              <div className="flex justify-end">
                <button
                  onClick={handleDeepReview}
                  disabled={reviewing}
                  className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-purple-600 transition-colors disabled:opacity-50"
                >
                  Re-run deep review <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Partners Tab ── */}
      {activeTab === 'partners' && (
        <SuggestedPartners entityType="opportunity" entityId={id} />
      )}
    </div>
  );
}
