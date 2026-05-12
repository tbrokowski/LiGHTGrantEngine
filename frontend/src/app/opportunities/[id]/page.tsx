'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { opportunities, ai } from '@/lib/api';
import SuggestedPartners from '@/components/crm/SuggestedPartners';

interface OpportunityDetail {
  id: string;
  title: string;
  funder?: string;
  program_name?: string;
  opportunity_url?: string;
  description?: string;
  ai_summary?: string;
  short_summary?: string;
  deadline?: string;
  loi_deadline?: string;
  award_min?: number;
  award_max?: number;
  currency?: string;
  fit_score?: number;
  priority?: string;
  status?: string;
  thematic_areas?: string[];
  geography?: string[];
  eligibility_criteria?: string;
  partner_requirements?: string;
  notes?: string;
  date_discovered?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  high_priority: 'bg-red-100 text-red-800',
  worth_reviewing: 'bg-amber-100 text-amber-800',
  watchlist: 'bg-blue-100 text-blue-800',
  low_fit: 'bg-gray-100 text-gray-600',
};

function formatDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'partners'>('overview');
  const [scoring, setScoring] = useState(false);

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
      setOpp(prev => prev ? { ...prev, fit_score: res.data.fit_score, priority: res.data.priority } : prev);
    } finally {
      setScoring(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400 text-sm">Loading…</div>;
  if (!opp) return (
    <div className="p-8 text-center text-gray-500">
      Opportunity not found. <Link href="/opportunities" className="text-blue-600 hover:underline">Back</Link>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-4">
        <Link href="/opportunities" className="hover:text-blue-600">Opportunities</Link>
        <span className="mx-2">›</span>
        <span className="text-gray-700 truncate">{opp.title}</span>
      </div>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-5">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{opp.title}</h1>
            <div className="text-sm text-gray-500 mt-1">
              {opp.funder && <span>{opp.funder}</span>}
              {opp.program_name && <span className="ml-2 text-gray-400">· {opp.program_name}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {opp.fit_score !== undefined && opp.fit_score !== null && (
              <span className="text-2xl font-bold text-gray-900">{Math.round(opp.fit_score)}</span>
            )}
            {opp.priority && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PRIORITY_COLORS[opp.priority] ?? ''}`}>
                {opp.priority.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {opp.deadline && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Deadline</div>
              <div className="text-sm font-semibold text-gray-800">{formatDate(opp.deadline)}</div>
            </div>
          )}
          {opp.loi_deadline && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">LOI</div>
              <div className="text-sm font-semibold text-gray-800">{formatDate(opp.loi_deadline)}</div>
            </div>
          )}
          {(opp.award_min || opp.award_max) && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Award</div>
              <div className="text-sm font-semibold text-gray-800">
                {opp.currency} {opp.award_max?.toLocaleString() ?? opp.award_min?.toLocaleString()}
              </div>
            </div>
          )}
          {opp.status && (
            <div className="text-center p-2.5 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-500 mb-0.5">Status</div>
              <div className="text-sm font-semibold text-gray-800">{opp.status.replace(/_/g, ' ')}</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {opp.opportunity_url && (
            <a href={opp.opportunity_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50">
              🔗 View Opportunity
            </a>
          )}
          <button onClick={handleScore} disabled={scoring}
            className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 px-2.5 py-1 rounded-lg hover:bg-purple-50 disabled:opacity-50">
            {scoring ? 'Scoring…' : '🤖 AI Score'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {(['overview', 'ai', 'partners'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab === 'partners' ? '🤝 Partners' : tab === 'ai' ? '🤖 AI Summary' : '📋 Overview'}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {(opp.thematic_areas ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Thematic Areas</h3>
              <div className="flex flex-wrap gap-1.5">
                {opp.thematic_areas!.map(t => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium">{t}</span>
                ))}
              </div>
            </div>
          )}
          {opp.description && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Description</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{opp.description}</p>
            </div>
          )}
          {opp.eligibility_criteria && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Eligibility</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{opp.eligibility_criteria}</p>
            </div>
          )}
          {opp.partner_requirements && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Partner Requirements</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{opp.partner_requirements}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          {opp.ai_summary ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{opp.ai_summary}</p>
          ) : (
            <div className="text-center py-10 text-gray-400 text-sm">
              No AI summary yet. Use the Score button to generate one.
            </div>
          )}
        </div>
      )}

      {activeTab === 'partners' && (
        <SuggestedPartners entityType="opportunity" entityId={id} />
      )}
    </div>
  );
}
