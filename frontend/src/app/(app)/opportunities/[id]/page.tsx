'use client';
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { opportunities, ai, api } from '@/lib/api';
import SuggestedPartners from '@/components/crm/SuggestedPartners';
import FunderLogo from '@/components/opportunities/FunderLogo';
import BookmarkButton from '@/components/opportunities/BookmarkButton';

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
}

const PRIORITY_LABELS: Record<string, string> = {
  high_priority: 'High priority',
  worth_reviewing: 'Worth reviewing',
  watchlist: 'Watchlist',
  low_fit: 'Low fit',
};

const PRIORITY_STYLES: Record<string, string> = {
  high_priority: 'text-red-700 bg-red-50 border-red-100',
  worth_reviewing: 'text-amber-700 bg-amber-50 border-amber-100',
  watchlist: 'text-blue-700 bg-blue-50 border-blue-100',
  low_fit: 'text-gray-500 bg-gray-100 border-gray-200',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

/** Render markdown with consistent prose styling */
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => (
          <h2 className="text-sm font-semibold text-gray-800 mt-5 mb-2 first:mt-0 border-b border-gray-100 pb-1">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-gray-700 mt-3 mb-1">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="text-sm text-gray-700 leading-relaxed mb-2">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1 mb-3 text-sm text-gray-700">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1 mb-3 text-sm text-gray-700">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-600">{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-200 pl-4 italic text-gray-600 my-2">{children}</blockquote>
        ),
        code: ({ children }) => (
          <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
        ),
        hr: () => <hr className="border-gray-200 my-3" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
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
  const [scoring, setScoring] = useState(false);
  const [converting, setConverting] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    opportunities.get(id)
      .then(r => setOpp(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleScore() {
    setScoring(true);
    try {
      const res = await ai.scoreOpportunity(id);
      setOpp(prev => prev ? { ...prev, fit_score: res.data.fit_score, priority: res.data.priority, fit_rationale: res.data.rationale } : prev);
    } finally {
      setScoring(false);
    }
  }

  async function handleRefetchDescription() {
    setRefetching(true);
    try {
      await api.post(`/opportunities/${id}/re-enrich`);
      alert('Re-enrichment queued. Refresh the page in a moment to see updated content.');
    } catch {
      alert('Failed to queue re-fetch.');
    } finally {
      setRefetching(false);
    }
  }

  async function handleGenerateSummary() {
    setGeneratingSummary(true);
    try {
      await api.post(`/opportunities/${id}/re-enrich`);
      alert('AI summary generation queued. Refresh in a moment to see results.');
    } catch {
      alert('Failed to queue summary generation.');
    } finally {
      setGeneratingSummary(false);
    }
  }

  async function handleConvert() {
    if (!confirm('Convert this opportunity to an active grant workspace?')) return;
    setConverting(true);
    try {
      const res = await opportunities.convertToGrant(id);
      router.push(`/grants/${res.data.grant_id}`);
    } finally {
      setConverting(false);
    }
  }

  async function handleToggleBookmark() {
    if (!opp) return;
    const isBookmarked = opp.status === 'potential_fit';
    setActionBusy(true);
    try {
      if (isBookmarked) {
        await opportunities.removeFromShortlist(id);
        setOpp(prev => prev ? { ...prev, status: 'in_review' } : prev);
      } else {
        await opportunities.update(id, { status: 'potential_fit' });
        setOpp(prev => prev ? { ...prev, status: 'potential_fit', is_read: true } : prev);
      }
    } finally {
      setActionBusy(false);
    }
  }

  const isShortlisted = opp?.status === 'potential_fit';

  if (loading) {
    return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
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
            {opp.fit_score != null && (
              <div className="text-right">
                <div className="text-3xl font-bold text-gray-900 leading-none">{Math.round(opp.fit_score)}</div>
                <div className="text-xs text-gray-400 mt-0.5">fit score</div>
              </div>
            )}
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
            onClick={handleScore}
            disabled={scoring}
            className="text-sm text-gray-700 border border-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {scoring ? 'Scoring…' : 'AI score'}
          </button>
          {opp.opportunity_url && (
            <button
              onClick={handleRefetchDescription}
              disabled={refetching}
              className="text-sm text-gray-700 border border-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {refetching ? 'Queuing…' : 'Refresh description'}
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
            {tab === 'ai' ? 'AI Summary' : tab === 'partners' ? 'Partners' : 'Overview'}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          {/* Fit Rationale */}
          {opp.fit_rationale && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Fit Rationale</h3>
              <p className="text-sm text-gray-700 leading-relaxed">{opp.fit_rationale}</p>
            </div>
          )}

          {/* Main Description */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</h3>
              {!opp.description && opp.opportunity_url && (
                <button
                  onClick={handleRefetchDescription}
                  disabled={refetching}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  {refetching ? 'Queuing…' : 'Fetch from source →'}
                </button>
              )}
            </div>
            {opp.description ? (
              <MarkdownContent content={opp.description} />
            ) : (
              <div className="text-sm text-gray-400 italic py-2">
                {opp.opportunity_url
                  ? 'Description not yet fetched. Click "Fetch from source" or "Refresh description" to retrieve it.'
                  : 'No description available and no source URL to fetch from.'}
              </div>
            )}
          </div>

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
                <MarkdownContent content={opp.eligibility_criteria} />
              </div>
            </CollapsibleSection>
          )}

          {/* Partner Requirements — collapsible */}
          {opp.partner_requirements && (
            <CollapsibleSection title="Partner Requirements">
              <div className="pt-3">
                <MarkdownContent content={opp.partner_requirements} />
              </div>
            </CollapsibleSection>
          )}

          {/* Evaluation Criteria — collapsible */}
          {opp.evaluation_criteria && (
            <CollapsibleSection title="Evaluation Criteria">
              <div className="pt-3">
                <MarkdownContent content={opp.evaluation_criteria} />
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

      {/* ── AI Summary Tab ── */}
      {activeTab === 'ai' && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          {opp.ai_summary ? (
            <MarkdownContent content={opp.ai_summary} />
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-400 text-sm mb-4">No AI summary yet.</p>
              <button
                onClick={handleGenerateSummary}
                disabled={generatingSummary}
                className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md transition-colors disabled:opacity-50 font-medium"
              >
                {generatingSummary ? 'Queuing…' : 'Generate AI Summary'}
              </button>
              <p className="text-xs text-gray-400 mt-2">
                The summary will include funding scope, eligibility, fit for LiGHT, project ideas, and action items.
              </p>
            </div>
          )}
          {opp.ai_summary && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={handleGenerateSummary}
                disabled={generatingSummary}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                {generatingSummary ? 'Queuing…' : 'Regenerate summary'}
              </button>
            </div>
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
