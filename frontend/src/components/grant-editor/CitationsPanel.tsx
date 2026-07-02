'use client';

import { useState } from 'react';
import { Search, ExternalLink, Loader2, Quote } from 'lucide-react';
import { grantWriting } from '@/lib/api';
import type { InsertableCitation } from '@/lib/citationFormat';

type Citation = InsertableCitation & { claim_text?: string };

interface CitationsPanelProps {
  grantId: string;
  citations: Citation[];
  onCitationsUpdate: (citations: Citation[]) => void;
  activeSection?: string;
  onInsertCitation: (citation: Citation) => void;
}

export default function CitationsPanel({
  grantId,
  citations,
  onCitationsUpdate,
  activeSection,
  onInsertCitation,
}: CitationsPanelProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [insertedIds, setInsertedIds] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      await grantWriting.searchCitations(grantId, {
        query: query.trim(),
        section_title: activeSection,
      });
      const updated = await grantWriting.listCitations(grantId);
      onCitationsUpdate(updated.data);
    } finally {
      setSearching(false);
    }
  };

  const handleInsert = (c: Citation, key: string) => {
    onInsertCitation(c);
    setInsertedIds((prev) => new Set(prev).add(key));
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200">
        <div className="text-xs font-semibold text-gray-700 mb-2">Citations</div>
        <div className="flex gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search OpenAlex + PubMed..."
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {citations.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-4">
            Search for citations to support claims in your proposal.
          </div>
        ) : (
          citations.map((c, i) => {
            const key = c.id || String(i);
            const inserted = insertedIds.has(key);
            return (
              <div key={key} className="text-xs border border-gray-100 rounded p-2">
                {c.source_type && (
                  <span className="text-[9px] uppercase tracking-wide text-gray-400">{c.source_type}</span>
                )}
                <div className="text-gray-700 mt-0.5">{c.formatted_citation}</div>
                <div className="flex items-center gap-3 mt-1.5">
                  {c.url && (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" /> Source
                    </a>
                  )}
                  <button
                    onClick={() => handleInsert(c, key)}
                    title="Insert (Author, Year) into the active section and add to Bibliography"
                    className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                      inserted
                        ? 'text-green-600'
                        : 'text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    <Quote className="w-3 h-3" /> {inserted ? 'Inserted' : 'Insert'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
