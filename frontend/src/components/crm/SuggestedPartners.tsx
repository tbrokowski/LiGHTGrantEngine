'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Check } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import PartnerTagChip from './PartnerTagChip';

interface Recommendation {
  partner_id: string;
  name: string;
  organization?: string;
  score: number;
  reason: string;
  suggested_role?: string;
}

interface SuggestedPartnersProps {
  entityType: 'opportunity' | 'grant';
  entityId: string;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-400' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-600 w-6 text-right">{score}</span>
    </div>
  );
}

export default function SuggestedPartners({ entityType, entityId }: SuggestedPartnersProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());

  async function loadRecommendations() {
    setLoading(true);
    setError('');
    try {
      const res = await partnersApi.recommendForGrant(entityType, entityId, 10);
      setRecommendations(res.data.recommendations ?? []);
      setReasoning(res.data.reasoning ?? '');
      setLoaded(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load recommendations.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleLink(rec: Recommendation) {
    setLinkingId(rec.partner_id);
    try {
      await partnersApi.addLink(rec.partner_id, {
        entity_type: entityType,
        entity_id: entityId,
        relationship: rec.suggested_role ?? 'collaborator',
        notes: `AI recommended: ${rec.reason}`,
      });
      setLinkedIds(prev => new Set([...prev, rec.partner_id]));
    } catch {
      alert('Failed to link partner.');
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          <h3 className="text-base font-semibold text-gray-900">Suggested Partners</h3>
        </div>
        {!loaded && (
          <button
            onClick={loadRecommendations}
            disabled={loading}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : 'Find Partners'}
          </button>
        )}
        {loaded && (
          <button
            onClick={loadRecommendations}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-2.5 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? '…' : 'Refresh'}
          </button>
        )}
      </div>

      {!loaded && !loading && (
        <div className="text-sm text-gray-400 text-center py-6">
          Click &quot;Find Partners&quot; to get AI-powered recommendations from your CRM.
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-400 text-center py-6 animate-pulse">
          Analyzing grant and matching partners…
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loaded && !loading && recommendations.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-4">
          No matching partners found. Add partners to your CRM to get recommendations.
        </div>
      )}

      {loaded && reasoning && recommendations.length > 0 && (
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3">{reasoning}</p>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-3">
          {recommendations.map(rec => (
            <div key={rec.partner_id} className="border border-gray-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <Link href={`/partners/${rec.partner_id}`}
                    className="text-sm font-semibold text-gray-900 hover:text-blue-600">
                    {rec.name}
                  </Link>
                  {rec.organization && (
                    <div className="text-xs text-gray-500 truncate">{rec.organization}</div>
                  )}
                </div>
                {rec.suggested_role && (
                  <PartnerTagChip tag={rec.suggested_role} />
                )}
              </div>

              <ScoreBar score={rec.score} />

              <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{rec.reason}</p>

              <div className="mt-2 flex gap-2">
                <Link href={`/partners/${rec.partner_id}`}
                  className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-50">
                  View Profile
                </Link>
                {linkedIds.has(rec.partner_id) ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 px-2 py-1"><Check className="w-3 h-3" /> Linked</span>
                ) : (
                  <button
                    onClick={() => handleLink(rec)}
                    disabled={linkingId === rec.partner_id}
                    className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    {linkingId === rec.partner_id ? 'Linking…' : '+ Link to Grant'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
