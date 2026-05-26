'use client';
import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { ai } from '@/lib/api';

interface AIPanelProps {
  opportunityId?: string;
  grantId?: string;
  archiveId?: string;
}

type Action = 'analyze-call' | 'go-no-go' | 'draft-section' | 'compliance' | 'similar-grants' | 'outline';

export default function AIPanel({ opportunityId, grantId, archiveId }: AIPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [sectionReqs, setSectionReqs] = useState('');
  const [proposalDraft, setProposalDraft] = useState('');
  const [query, setQuery] = useState('');

  const run = async (action: Action) => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      let res;
      if (action === 'analyze-call' && opportunityId)
        res = await ai.analyzeCall({ opportunity_id: opportunityId });
      else if (action === 'go-no-go' && opportunityId)
        res = await ai.goNoGo({ opportunity_id: opportunityId });
      else if (action === 'outline' && grantId)
        res = await ai.proposalOutline({ grant_id: grantId });
      else if (action === 'draft-section' && grantId)
        res = await ai.draftSection({ grant_id: grantId, section_name: sectionName, section_type: 'other', call_requirements: sectionReqs });
      else if (action === 'compliance' && grantId)
        res = await ai.complianceCheck({ grant_id: grantId, proposal_draft: proposalDraft });
      else if (action === 'similar-grants')
        res = await ai.findSimilarGrants({ query, top_k: 6 });
      if (res) setResult(res.data);
    } catch (e: unknown) {
      setError((e as Error).message || 'AI request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
        <span className="text-purple-600 font-semibold text-sm">AI Assistant</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {opportunityId && (
          <>
            <button onClick={() => run('analyze-call')} disabled={loading}
              className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
              Analyze call
            </button>
            <button onClick={() => run('go-no-go')} disabled={loading}
              className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
              Go/No-Go memo
            </button>
          </>
        )}
        {grantId && (
          <>
            <button onClick={() => run('outline')} disabled={loading}
              className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
              Proposal outline
            </button>
            <button onClick={() => run('compliance')} disabled={loading}
              className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
              Compliance check
            </button>
          </>
        )}
      </div>

      {grantId && (
        <div className="mb-3 space-y-1">
          <input value={sectionName} onChange={e => setSectionName(e.target.value)}
            placeholder="Section name (e.g. Methods)"
            className="w-full text-xs border border-purple-200 rounded px-2 py-1.5" />
          <textarea value={sectionReqs} onChange={e => setSectionReqs(e.target.value)}
            placeholder="Paste call requirements for this section..."
            className="w-full text-xs border border-purple-200 rounded px-2 py-1.5 h-16 resize-none" />
          <button onClick={() => run('draft-section')} disabled={loading || !sectionName}
            className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
            Draft section
          </button>
        </div>
      )}

      {grantId && (
        <div className="mb-3">
          <textarea value={proposalDraft} onChange={e => setProposalDraft(e.target.value)}
            placeholder="Paste proposal draft for compliance check..."
            className="w-full text-xs border border-purple-200 rounded px-2 py-1.5 h-16 resize-none mb-1" />
        </div>
      )}

      <div className="mb-3">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Find similar past grants..."
          className="w-full text-xs border border-purple-200 rounded px-2 py-1.5 mb-1" />
        <button onClick={() => run('similar-grants')} disabled={loading || !query}
          className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
          Search archive
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-purple-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Analyzing...
        </div>
      )}
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      {result && (
        <div className="mt-3 bg-white rounded-lg p-3 text-xs text-gray-800 max-h-64 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
