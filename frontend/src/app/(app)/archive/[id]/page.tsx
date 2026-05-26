'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { archive } from '@/lib/api';

interface ProposalSection {
  id: string;
  section_type: string;
  section_title?: string | null;
  section_text: string;
  word_count?: number | null;
  ai_retrieval_allowed?: boolean;
}

interface ArchiveDocument {
  id: string;
  file_name?: string | null;
  processing_status?: string | null;
}

interface DocumentStructureItem {
  order: number;
  title: string;
  section_type: string;
  word_count?: number;
  heading_level?: number;
}

interface ArchiveDetail {
  id: string;
  title: string;
  funder?: string;
  program_name?: string;
  call_url?: string;
  call_year?: number;
  lead_pi?: string;
  co_investigators?: string[];
  submission_date?: string;
  decision_date?: string;
  outcome?: string;
  requested_amount?: number;
  awarded_amount?: number;
  currency?: string;
  themes?: string[];
  geographies?: string[];
  abstract?: string;
  outcome_notes?: string;
  lessons_learned?: string;
  reuse_approved?: boolean;
  notes?: string;
  section_count?: number;
  style_indexed?: boolean;
  style_indexed_at?: string | null;
  document_structure?: DocumentStructureItem[];
  style_fingerprint?: Record<string, unknown>;
  sections?: ProposalSection[];
  documents?: ArchiveDocument[];
}

const OUTCOME_STYLES: Record<string, string> = {
  awarded: 'text-green-700 bg-green-50',
  rejected: 'text-red-700 bg-red-50',
  pending: 'text-amber-700 bg-amber-50',
  withdrawn: 'text-gray-500 bg-gray-100',
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

export default function ArchiveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<ArchiveDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState('');
  const [reindexError, setReindexError] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    archive.get(id)
      .then(r => setEntry(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleReindex() {
    if (!entry) return;
    const docId = entry.documents?.[0]?.id;
    if (!docId) {
      setReindexError('No indexed document found to re-index.');
      return;
    }
    setReindexing(true);
    setReindexError('');
    setReindexMessage('');
    try {
      const res = await archive.reindexStyle(entry.id, { document_id: docId });
      const count = res.data.sections_created ?? 0;
      const styled = Boolean(res.data.style_fingerprint);
      setReindexMessage(
        `Re-indexed ${count} section${count === 1 ? '' : 's'}${styled ? ' with style fingerprint' : ''} for AI retrieval.`
      );
      load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setReindexError(typeof detail === 'string' ? detail : 'Re-index failed. Please try again.');
    } finally {
      setReindexing(false);
    }
  }

  if (loading) return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;
  if (!entry) {
    return (
      <div className="px-8 py-16 text-center text-gray-500 text-sm">
        Archive entry not found.{' '}
        <Link href="/archive" className="text-blue-600 hover:underline">Back to archive</Link>
      </div>
    );
  }

  const sectionCount = entry.section_count ?? entry.sections?.length ?? 0;
  const primaryDoc = entry.documents?.[0];

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto">
      <div className="text-sm text-gray-400 mb-6 flex items-center gap-2">
        <Link href="/archive" className="hover:text-gray-700">Archive</Link>
        <span>/</span>
        <span className="text-gray-600 truncate">{entry.title}</span>
      </div>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{entry.title}</h1>
            <div className="text-sm text-gray-500 mt-1.5 flex flex-wrap gap-2">
              {entry.funder && <span>{entry.funder}</span>}
              {entry.program_name && <><span className="text-gray-300">·</span><span>{entry.program_name}</span></>}
              {entry.call_year && <><span className="text-gray-300">·</span><span>{entry.call_year}</span></>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {entry.outcome && (
              <span className={`text-xs px-2.5 py-1 rounded font-medium ${OUTCOME_STYLES[entry.outcome] ?? 'text-gray-500 bg-gray-100'}`}>
                {entry.outcome}
              </span>
            )}
            {sectionCount > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                Indexed for AI · {sectionCount} section{sectionCount === 1 ? '' : 's'}
              </span>
            )}
            {entry.style_indexed && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 font-medium">
                Style indexed
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {entry.lead_pi && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Lead PI</div>
              <div className="text-sm font-medium text-gray-800">{entry.lead_pi}</div>
            </div>
          )}
          {entry.submission_date && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Submitted</div>
              <div className="text-sm font-medium text-gray-800">{formatDate(entry.submission_date)}</div>
            </div>
          )}
          {entry.requested_amount && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Requested</div>
              <div className="text-sm font-medium text-gray-800">{entry.currency} {entry.requested_amount.toLocaleString()}</div>
            </div>
          )}
          {entry.awarded_amount && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-400 mb-0.5">Awarded</div>
              <div className="text-sm font-medium text-gray-800">{entry.currency} {entry.awarded_amount.toLocaleString()}</div>
            </div>
          )}
        </div>

        {entry.call_url && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <a href={entry.call_url} target="_blank" rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline">View original call</a>
          </div>
        )}
      </div>

      {/* AI indexing panel */}
      {(sectionCount > 0 || primaryDoc) && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Corpus</h3>
              {primaryDoc?.file_name && (
                <p className="text-sm text-gray-600">
                  Source: <span className="font-medium">{primaryDoc.file_name}</span>
                </p>
              )}
            </div>
            {primaryDoc && (
              <button
                onClick={handleReindex}
                disabled={reindexing}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {reindexing ? 'Re-indexing…' : 'Re-index'}
              </button>
            )}
          </div>

          {reindexMessage && (
            <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">{reindexMessage}</p>
          )}
          {reindexError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{reindexError}</p>
          )}

          {(entry.document_structure ?? []).length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-gray-500 mb-2">Document structure</h4>
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-400">
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">Section</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-right px-3 py-2 font-medium">Words</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {entry.document_structure!.map(item => (
                      <tr key={`${item.order}-${item.title}`}>
                        <td className="px-3 py-2 text-gray-400 tabular-nums">{item.order}</td>
                        <td className="px-3 py-2 text-gray-800">{item.title}</td>
                        <td className="px-3 py-2 text-gray-500">{item.section_type}</td>
                        <td className="px-3 py-2 text-gray-500 text-right tabular-nums">{item.word_count ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(entry.sections ?? []).length > 0 ? (
            <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
              {entry.sections!.map(section => (
                <div key={section.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800">
                      {section.section_title || section.section_type}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums shrink-0">
                      {section.word_count ? `${section.word_count} words` : section.section_type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{section.section_text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No sections indexed yet.</p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {entry.abstract && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Abstract</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.abstract}</p>
          </div>
        )}
        {(entry.themes ?? []).length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Themes</h3>
            <div className="flex flex-wrap gap-1.5">
              {entry.themes!.map(t => (
                <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{t}</span>
              ))}
            </div>
          </div>
        )}
        {entry.outcome_notes && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Outcome Notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.outcome_notes}</p>
          </div>
        )}
        {entry.lessons_learned && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Lessons Learned</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.lessons_learned}</p>
          </div>
        )}
        {entry.notes && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
