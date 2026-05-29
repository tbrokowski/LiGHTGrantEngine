'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Compass, Search, Plus, GraduationCap, ExternalLink } from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';

interface Candidate {
  name: string;
  title?: string;
  organization?: string;
  department?: string;
  country?: string;
  expertise: string[];
  h_index?: number;
  url?: string;
  source: string;
  confidence: number;
}

const ORG_TYPES = [
  { value: '', label: 'Any institution type' },
  { value: 'university', label: 'University' },
  { value: 'research institute', label: 'Research institute' },
  { value: 'industry', label: 'Industry / Company' },
  { value: 'ngo', label: 'NGO / Non-profit' },
  { value: 'government', label: 'Government' },
  { value: 'hospital', label: 'Hospital / Clinical' },
];

function CandidateCard({ candidate, onAdd }: { candidate: Candidate; onAdd: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="text-sm font-semibold text-gray-900">{candidate.name}</h3>
            {candidate.h_index != null && (
              <span className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                <GraduationCap className="w-3 h-3" />h-index {candidate.h_index}
              </span>
            )}
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              candidate.source === 'openalex' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
            }`}>
              {candidate.source === 'openalex' ? 'OpenAlex' : 'Web'}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            {[candidate.title, candidate.organization].filter(Boolean).join(' · ')}
          </div>
          {candidate.country && <div className="text-xs text-gray-400 mt-0.5">📍 {candidate.country}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {candidate.url && (
            <a href={candidate.url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-blue-600 border border-gray-200 rounded-lg">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={onAdd}
            className="flex items-center gap-1 text-xs text-blue-600 border border-blue-200 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 font-medium">
            <Plus className="w-3 h-3" />Add to CRM
          </button>
        </div>
      </div>

      {candidate.expertise.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {candidate.expertise.map(e => (
            <span key={e} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{e}</span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.round(candidate.confidence * 100)}%` }} />
        </div>
        <span className="text-xs text-gray-400">{Math.round(candidate.confidence * 100)}% match</span>
      </div>
    </div>
  );
}

export default function PartnerDiscoveryPage() {
  const [query, setQuery] = useState('');
  const [institutionType, setInstitutionType] = useState('');
  const [country, setCountry] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const res = await partnersApi.discover({
        q: query,
        institution_type: institutionType || undefined,
        country: country || undefined,
      });
      setResults(res.data.candidates || []);
    } catch {
      setError('Search failed. Please try again.');
    } finally { setLoading(false); }
  }

  async function handleAdd(candidate: Candidate) {
    const key = `${candidate.name}-${candidate.organization || ''}`;
    try {
      await partnersApi.create({
        name: candidate.name,
        title: candidate.title,
        organization: candidate.organization,
        department: candidate.department,
        country: candidate.country,
        tags: candidate.expertise || [],
        status: 'prospect',
        relationship_stage: 'prospect',
        website: candidate.url,
        h_index: candidate.h_index,
      });
      setAddedIds(prev => new Set([...prev, key]));
    } catch { alert('Failed to add partner.'); }
  }

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <Link href="/partners" className="hover:text-gray-700">Partners</Link>
          <span>/</span>
          <span className="text-gray-600">Discover</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Compass className="w-6 h-6 text-purple-600" />
          Find Partners
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Search for potential research partners using AI-powered web search and OpenAlex academic database.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Research area / expertise *</label>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. climate change adaptation, machine learning in healthcare, urban mobility"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Institution type</label>
              <select value={institutionType} onChange={e => setInstitutionType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                {ORG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Country / Region (optional)</label>
              <input value={country} onChange={e => setCountry(e.target.value)}
                placeholder="Switzerland, Europe, USA…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          <button type="submit" disabled={!query.trim() || loading}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Searching…</>
            ) : (
              <><Search className="w-4 h-4" />Search for Partners</>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>
      )}

      {/* Results */}
      {results !== null && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              {results.length > 0 ? `${results.length} candidates found` : 'No candidates found'}
            </h2>
            <span className="text-xs text-gray-400">Sources: OpenAlex + Web search</span>
          </div>

          {results.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-sm text-gray-500">No candidates found. Try broader keywords or different institution type.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {results.map((candidate, i) => {
                const key = `${candidate.name}-${candidate.organization || ''}`;
                const added = addedIds.has(key);
                return added ? (
                  <div key={i} className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                    <span className="text-xs text-green-700">✓ Added to CRM:</span>
                    <span className="text-sm font-medium text-green-800">{candidate.name}</span>
                    <Link href="/partners" className="ml-auto text-xs text-green-600 hover:underline">View in Partners →</Link>
                  </div>
                ) : (
                  <CandidateCard key={i} candidate={candidate} onAdd={() => handleAdd(candidate)} />
                );
              })}
            </div>
          )}
        </div>
      )}

      {!results && !loading && (
        <div className="text-center py-12">
          <Compass className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Search for researchers, academics, or professionals in any domain.</p>
          <p className="text-xs text-gray-300 mt-1">Powered by OpenAlex academic database + Tavily web search</p>
        </div>
      )}
    </div>
  );
}
