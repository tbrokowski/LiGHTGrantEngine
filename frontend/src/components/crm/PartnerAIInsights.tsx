'use client';
import { useState } from 'react';
import { Sparkles, TrendingUp, AlertCircle, Copy, Check } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface FitScore {
  entity_type: string;
  entity_id: string;
  title: string;
  funder: string;
  status: string;
  match_signal: number;
}

interface PartnerAIInsightsProps {
  partnerId: string;
  partnerName: string;
  tags: string[];
  lastContact?: string;
  nextContact?: string;
}

function OutreachDraftModal({
  partnerId,
  partnerName,
  onClose,
}: { partnerId: string; partnerName: string; onClose: () => void }) {
  const [purpose, setPurpose] = useState('');
  const [grantContext, setGrantContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!purpose.trim()) return;
    setLoading(true);
    try {
      const res = await partnersApi.draftOutreach(partnerId, { purpose, grant_context: grantContext });
      setDraft(res.data);
    } finally { setLoading(false); }
  }

  function handleCopy() {
    if (!draft) return;
    navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />Draft Email to {partnerName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          {!draft ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Purpose / Goal *</label>
                <textarea value={purpose} onChange={e => setPurpose(e.target.value)} rows={2} autoFocus
                  placeholder="e.g. Invite to collaborate on ERC grant about climate adaptation"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Grant context (optional)</label>
                <input value={grantContext} onChange={e => setGrantContext(e.target.value)}
                  placeholder="ERC 2026 — Climate Resilience, due March 2026"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={handleGenerate} disabled={!purpose.trim() || loading}
                className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {loading ? 'Drafting…' : 'Generate Email Draft'}
              </button>
            </>
          ) : (
            <>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <span className="text-xs text-gray-500">Subject: </span>
                  <span className="text-sm font-medium text-gray-800">{draft.subject}</span>
                </div>
                <div className="p-3">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{draft.body}</pre>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 font-medium">
                  {copied ? <><Check className="w-3.5 h-3.5 text-green-600" />Copied!</> : <><Copy className="w-3.5 h-3.5" />Copy Email</>}
                </button>
                <button onClick={() => setDraft(null)}
                  className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 font-medium">
                  Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PartnerAIInsights({ partnerId, partnerName, tags, lastContact, nextContact }: PartnerAIInsightsProps) {
  const [fitScores, setFitScores] = useState<FitScore[] | null>(null);
  const [loadingFit, setLoadingFit] = useState(false);
  const [showOutreach, setShowOutreach] = useState(false);

  async function loadFitScores() {
    setLoadingFit(true);
    try {
      const res = await partnersApi.fitScores(partnerId);
      setFitScores(res.data.scores || []);
    } finally { setLoadingFit(false); }
  }

  // Relationship health
  const daysSinceContact = lastContact
    ? Math.floor((Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isOverdue = nextContact && new Date(nextContact) < new Date();

  const healthStatus = !lastContact
    ? { label: 'Not contacted', color: 'text-gray-500', dot: 'bg-gray-300' }
    : isOverdue
    ? { label: 'Follow-up overdue', color: 'text-red-600', dot: 'bg-red-500' }
    : daysSinceContact && daysSinceContact > 45
    ? { label: `${daysSinceContact}d since last contact`, color: 'text-amber-600', dot: 'bg-amber-400' }
    : { label: 'Relationship healthy', color: 'text-green-600', dot: 'bg-green-500' };

  return (
    <div className="space-y-5">
      {/* Relationship health */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" />Relationship Health
        </h3>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2.5 h-2.5 rounded-full ${healthStatus.dot}`} />
          <span className={`text-sm font-medium ${healthStatus.color}`}>{healthStatus.label}</span>
        </div>
        {isOverdue && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-2.5 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Follow-up was due {nextContact ? new Date(nextContact).toLocaleDateString() : ''}. Time to reconnect.
          </div>
        )}
        {daysSinceContact && daysSinceContact > 45 && !isOverdue && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-xs text-amber-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            It&apos;s been {daysSinceContact} days since your last interaction. Consider scheduling a check-in.
          </div>
        )}

        {/* Suggested actions */}
        <div className="mt-3 space-y-1.5">
          <button onClick={() => setShowOutreach(true)}
            className="w-full text-left text-xs text-gray-600 hover:text-blue-700 hover:bg-blue-50 px-2.5 py-2 rounded-lg transition-colors flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Draft outreach email with AI
          </button>
        </div>
      </div>

      {/* Grant fit scores */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />Grant Fit
          </h3>
          {!fitScores && (
            <button onClick={loadFitScores} disabled={loadingFit}
              className="text-xs text-purple-600 border border-purple-200 px-2.5 py-1 rounded-lg hover:bg-purple-50 disabled:opacity-50">
              {loadingFit ? 'Loading…' : 'Check Fit'}
            </button>
          )}
        </div>

        {!fitScores && !loadingFit && (
          <p className="text-xs text-gray-400 text-center py-4">
            Check which open grants {partnerName} would be a good fit for.
          </p>
        )}
        {loadingFit && (
          <p className="text-xs text-gray-400 text-center py-4 animate-pulse">Analyzing fit across open grants…</p>
        )}
        {fitScores && fitScores.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">No open grants found to compare.</p>
        )}
        {fitScores && fitScores.length > 0 && (
          <div className="space-y-2">
            {fitScores.slice(0, 6).map(fs => (
              <div key={fs.entity_id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{fs.title || fs.entity_id}</p>
                  {fs.funder && <p className="text-xs text-gray-400 truncate">{fs.funder}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${fs.match_signal >= 0.5 ? 'bg-green-500' : fs.match_signal >= 0.2 ? 'bg-yellow-400' : 'bg-gray-300'}`}
                      style={{ width: `${Math.max(fs.match_signal * 100, 5)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{Math.round(fs.match_signal * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showOutreach && (
        <OutreachDraftModal partnerId={partnerId} partnerName={partnerName} onClose={() => setShowOutreach(false)} />
      )}
    </div>
  );
}
