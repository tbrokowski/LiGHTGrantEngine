'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { archive } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import ViewToggle from '@/components/opportunities/ViewToggle';
import ArchiveGraphView, {
  type ArchiveGraphNode,
  type ArchiveGraphCluster,
  type ArchiveGraphEdge,
} from '@/components/archive/ArchiveGraphView';
import ArchiveGraphFilters, {
  type ArchiveGraphFilterState,
} from '@/components/archive/ArchiveGraphFilters';

interface ArchiveEntry {
  id: string;
  title: string;
  funder: string | null;
  call_year: number | null;
  outcome: string | null;
  lead_pi: string | null;
  themes: string[];
  requested_amount: number | null;
  awarded_amount: number | null;
  currency: string | null;
  submission_date: string | null;
  section_count?: number;
  style_indexed?: boolean;
  indexing_status?: string;
  indexing_error?: string | null;
}

const OUTCOMES = [
  { value: '', label: 'All' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'pending', label: 'Pending' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'not_submitted', label: 'Not submitted' },
  { value: 'partially_funded', label: 'Partial' },
];

const OUTCOME_STYLES: Record<string, string> = {
  awarded: 'text-emerald-700 bg-emerald-50',
  rejected: 'text-red-600 bg-red-50',
  pending: 'text-amber-700 bg-amber-50',
  withdrawn: 'text-gray-500 bg-gray-100',
  deferred: 'text-gray-500 bg-gray-100',
  not_submitted: 'text-gray-500 bg-gray-100',
  resubmitted: 'text-blue-600 bg-blue-50',
  partially_funded: 'text-teal-700 bg-teal-50',
};

function formatAmount(amt: number | null, currency: string | null) {
  if (!amt) return null;
  const c = currency ?? 'USD';
  return amt >= 1_000_000
    ? `${c} ${(amt / 1_000_000).toFixed(1)}M`
    : `${c} ${amt.toLocaleString()}`;
}

interface NewArchiveForm {
  title: string;
  funder: string;
  lead_pi: string;
  call_year: string;
  submission_date: string;
  outcome: string;
  requested_amount: string;
  awarded_amount: string;
  currency: string;
  notes: string;
  lessons_learned: string;
  ai_retrieval_allowed: boolean;
  text_reuse_allowed: boolean;
}

function FileUploadButton({
  label,
  file,
  onPick,
  inputRef,
  accept,
  hint,
  required,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  hint: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full border border-dashed border-gray-300 rounded-xl px-3 py-3 text-sm text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
      >
        {file ? (
          <span className="text-gray-800">{file.name}</span>
        ) : (
          <span className="text-gray-400">Click to upload</span>
        )}
      </button>
      <p className="text-[10px] text-gray-400 mt-1">{hint}</p>
    </div>
  );
}

function NewArchiveModal({ onClose, onCreated }: { onClose: () => void; onCreated: (message?: string) => void }) {
  const [form, setForm] = useState<NewArchiveForm>({
    title: '',
    funder: '',
    lead_pi: '',
    call_year: '',
    submission_date: '',
    outcome: 'pending',
    requested_amount: '',
    awarded_amount: '',
    currency: 'USD',
    notes: '',
    lessons_learned: '',
    ai_retrieval_allowed: true,
    text_reuse_allowed: false,
  });
  const [proposalFile, setProposalFile] = useState<File | null>(null);
  const [callFile, setCallFile] = useState<File | null>(null);
  const [budgetFile, setBudgetFile] = useState<File | null>(null);
  const [feedbackFile, setFeedbackFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const proposalFileRef = useRef<HTMLInputElement>(null);
  const callFileRef = useRef<HTMLInputElement>(null);
  const budgetFileRef = useRef<HTMLInputElement>(null);
  const feedbackFileRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const FILE_ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const BUDGET_ACCEPT = `${FILE_ACCEPT},.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;

  useEffect(() => { firstRef.current?.focus(); }, []);

  function setField<K extends keyof NewArchiveForm>(key: K, value: NewArchiveForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!proposalFile) { setError('Submitted proposal (PDF or DOCX) is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('proposal_file', proposalFile);
      if (callFile) fd.append('call_file', callFile);
      if (budgetFile) fd.append('budget_file', budgetFile);
      if (feedbackFile) fd.append('feedback_file', feedbackFile);
      fd.append('title', form.title.trim());
      fd.append('outcome', form.outcome || 'pending');
      fd.append('submitted', 'true');
      fd.append('ai_retrieval_allowed', String(form.ai_retrieval_allowed));
      fd.append('text_reuse_allowed', String(form.text_reuse_allowed));
      if (form.funder) fd.append('funder', form.funder);
      if (form.lead_pi) fd.append('lead_pi', form.lead_pi);
      if (form.call_year) fd.append('call_year', form.call_year);
      if (form.submission_date) fd.append('submission_date', form.submission_date);
      if (form.requested_amount) fd.append('requested_amount', form.requested_amount.replace(/,/g, ''));
      if (form.awarded_amount) fd.append('awarded_amount', form.awarded_amount.replace(/,/g, ''));
      if (form.currency) fd.append('currency', form.currency);
      if (form.notes) fd.append('notes', form.notes);
      if (form.lessons_learned) fd.append('lessons_learned', form.lessons_learned);

      await archive.createWithDocument(fd);
      const docCount = 1 + (callFile ? 1 : 0) + (budgetFile ? 1 : 0) + (feedbackFile ? 1 : 0);
      onCreated(
        `Archive entry saved with ${docCount} document${docCount === 1 ? '' : 's'}. ` +
        'AI indexing is running in the background — you can continue working.'
      );
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: { data?: { detail?: string } } };
      const detail = axiosErr.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : axiosErr.code === 'ECONNABORTED'
          ? 'Upload timed out. The file may be too large or the server is busy — please try again.'
          : 'Failed to save archive entry. Please try again.';
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Add to Archive</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form id="archive-form" onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {saving && (
            <div className="flex items-center gap-2.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
              <svg className="w-3.5 h-3.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading documents… this may take a moment for large files.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Title <span className="text-red-400">*</span></label>
            <input
              ref={firstRef}
              type="text"
              value={form.title}
              onChange={e => setField('title', e.target.value)}
              placeholder="Grant or proposal title"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Funder</label>
              <input
                type="text"
                value={form.funder}
                onChange={e => setField('funder', e.target.value)}
                placeholder="Organization"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Lead PI</label>
              <input
                type="text"
                value={form.lead_pi}
                onChange={e => setField('lead_pi', e.target.value)}
                placeholder="PI name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Call year</label>
              <input
                type="number"
                value={form.call_year}
                onChange={e => setField('call_year', e.target.value)}
                placeholder={String(new Date().getFullYear())}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Submission date</label>
              <input
                type="date"
                value={form.submission_date}
                onChange={e => setField('submission_date', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Outcome</label>
            <select
              value={form.outcome}
              onChange={e => setField('outcome', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            >
              {OUTCOMES.filter(o => o.value).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={e => setField('currency', e.target.value)}
                placeholder="USD"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Requested</label>
              <input
                type="text"
                value={form.requested_amount}
                onChange={e => setField('requested_amount', e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Awarded</label>
              <input
                type="text"
                value={form.awarded_amount}
                onChange={e => setField('awarded_amount', e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300"
              />
            </div>
          </div>

          <FileUploadButton
            label="Call / RFP document"
            file={callFile}
            onPick={setCallFile}
            inputRef={callFileRef}
            accept={FILE_ACCEPT}
            hint="Optional — call text is stored and embedded for AI retrieval."
          />
          <FileUploadButton
            label="Submitted proposal"
            file={proposalFile}
            onPick={setProposalFile}
            inputRef={proposalFileRef}
            accept={FILE_ACCEPT}
            hint="Required — split into sections and indexed for grant writing (runs in background)."
            required
          />
          <FileUploadButton
            label="Budget"
            file={budgetFile}
            onPick={setBudgetFile}
            inputRef={budgetFileRef}
            accept={BUDGET_ACCEPT}
            hint="Optional — PDF, DOCX, or spreadsheet (XLSX/CSV)."
          />
          <FileUploadButton
            label="Reviewer feedback / call response"
            file={feedbackFile}
            onPick={setFeedbackFile}
            inputRef={feedbackFileRef}
            accept={FILE_ACCEPT}
            hint="Optional — panel comments, call response letter, or reviewer notes (PDF/DOCX/TXT)."
          />

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={form.ai_retrieval_allowed}
                onChange={e => setField('ai_retrieval_allowed', e.target.checked)}
                className="rounded border-gray-300"
              />
              Allow AI retrieval from this proposal
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={form.text_reuse_allowed}
                onChange={e => setField('text_reuse_allowed', e.target.checked)}
                className="rounded border-gray-300"
              />
              Allow direct text reuse (otherwise paraphrase-only)
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Lessons learned</label>
            <textarea
              value={form.lessons_learned}
              onChange={e => setField('lessons_learned', e.target.value)}
              rows={2}
              placeholder="What worked, what didn't…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              rows={2}
              placeholder="Internal notes…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300 resize-none"
            />
          </div>
        </form>
        <div className="px-6 pb-5 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="archive-form"
            disabled={saving}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading…
              </>
            ) : 'Add to Archive'}
          </button>
        </div>
      </div>
    </div>
  );
}

const GRAPH_FILTERS_EMPTY: ArchiveGraphFilterState = {
  funder: '',
  outcome: '',
  year: '',
  theme: '',
};

export default function ArchivePage() {
  const { user } = useAuth();
  const canUpload = user?.role === 'admin' || user?.role === 'grant_lead' || user?.institution_role === 'admin';

  // ── List view state ─────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // ── View toggle ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');

  // ── Graph view state ─────────────────────────────────────────────────────────
  const [graphNodes, setGraphNodes] = useState<ArchiveGraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<ArchiveGraphEdge[]>([]);
  const [graphClusters, setGraphClusters] = useState<ArchiveGraphCluster[]>([]);
  const [graphFilters, setGraphFilters] = useState<ArchiveGraphFilterState>(GRAPH_FILTERS_EMPTY);
  const [graphLoading, setGraphLoading] = useState(false);

  // ── List load ───────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    archive.list(search ? { search } : {})
      .then(r => setEntries(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const indexing = entries.some(
      e => e.indexing_status === 'pending' || e.indexing_status === 'processing'
    );
    if (!indexing) return;
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [entries, load]);

  // ── Graph load ───────────────────────────────────────────────────────────────
  const loadGraph = useCallback((filters: ArchiveGraphFilterState) => {
    setGraphLoading(true);
    const params: Record<string, unknown> = {};
    if (filters.funder) params.funder = filters.funder;
    if (filters.outcome) params.outcome = filters.outcome;
    if (filters.year) params.year = Number(filters.year);
    if (filters.theme) params.theme = filters.theme;
    archive.graphData(params)
      .then(r => {
        setGraphNodes(r.data.nodes ?? []);
        setGraphEdges(r.data.edges ?? []);
        setGraphClusters(r.data.clusters ?? []);
      })
      .catch(console.error)
      .finally(() => setGraphLoading(false));
  }, []);

  useEffect(() => {
    if (viewMode === 'graph') loadGraph(graphFilters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  function handleGraphFiltersChange(f: ArchiveGraphFilterState) {
    setGraphFilters(f);
    loadGraph(f);
  }

  // ── Derived values for filters dropdowns ─────────────────────────────────────
  const allFunders = [...new Set(entries.map(e => e.funder).filter(Boolean) as string[])].sort();
  const allYears = [...new Set(entries.map(e => e.call_year).filter(Boolean) as number[])].sort((a, b) => b - a);
  const allThemes = [...new Set(entries.flatMap(e => e.themes ?? []))].sort();

  function handleCreated(message?: string) {
    setShowModal(false);
    if (message) setSuccessMessage(message);
    load();
  }

  const filtered = outcomeFilter
    ? entries.filter(e => e.outcome === outcomeFilter)
    : entries;

  const outcomeCounts = OUTCOMES.reduce<Record<string, number>>((acc, o) => {
    if (!o.value) {
      acc[''] = entries.length;
    } else {
      acc[o.value] = entries.filter(e => e.outcome === o.value).length;
    }
    return acc;
  }, {});

  return (
    <div className={viewMode === 'graph' ? 'flex flex-col h-full' : 'px-8 py-8 max-w-6xl mx-auto'}>
      {showModal && (
        <NewArchiveModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Success banner */}
      {successMessage && (
        <div className={`flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm text-emerald-800 ${viewMode === 'graph' ? 'mx-6 mt-4' : 'mb-4'}`}>
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')} className="text-emerald-600 hover:text-emerald-800">×</button>
        </div>
      )}

      {/* Header */}
      <div className={`flex items-start justify-between ${viewMode === 'graph' ? 'px-6 pt-6 pb-3 shrink-0' : 'mb-6'}`}>
        <div>
          <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Grant Archive</h1>
          <p className="text-sm text-gray-400 mt-0.5">Institutional memory — all past submissions</p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' && (
            <input
              type="text"
              placeholder="Search archive…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            />
          )}
          <ViewToggle view={viewMode} onChange={setViewMode} />
          {canUpload && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add entry
            </button>
          )}
        </div>
      </div>

      {/* ── Graph view ───────────────────────────────────────────────────────── */}
      {viewMode === 'graph' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Graph filter bar */}
          <div className="px-6 pb-3 shrink-0 flex items-center gap-3 flex-wrap">
            <ArchiveGraphFilters
              filters={graphFilters}
              onChange={handleGraphFiltersChange}
              funders={allFunders}
              years={allYears}
              themes={allThemes}
            />
            {graphLoading && (
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading graph…
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden border-t border-gray-100">
            <ArchiveGraphView
              nodes={graphNodes}
              edges={graphEdges}
              clusters={graphClusters}
            />
          </div>
        </div>
      )}

      {/* ── List view ────────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <>
          {/* Outcome filter tabs */}
          <div className="flex gap-0 mb-6 border-b border-gray-100 overflow-x-auto">
            {OUTCOMES.map(o => {
              const count = outcomeCounts[o.value] ?? 0;
              if (!o.value && !loading && entries.length === 0) return null;
              return (
                <button
                  key={o.value}
                  onClick={() => setOutcomeFilter(o.value)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    outcomeFilter === o.value
                      ? 'border-gray-900 text-gray-900'
                      : 'border-transparent text-gray-400 hover:text-gray-700'
                  }`}
                >
                  {o.label}
                  {count > 0 && (
                    <span className={`text-xs tabular-nums ${outcomeFilter === o.value ? 'text-gray-600' : 'text-gray-300'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Funder</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">PI</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Year</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">AI</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center text-sm text-gray-300">Loading…</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center">
                      <p className="text-sm text-gray-400">
                        {search ? 'No matches found.' : 'Archive is empty.'}
                      </p>
                      {!search && (
                        <button
                          onClick={() => setShowModal(true)}
                          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 mt-1"
                        >
                          Add the first entry
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link href={`/archive/${entry.id}`} className="font-medium text-gray-900 hover:text-gray-600 block truncate max-w-xs">
                          {entry.title}
                        </Link>
                        {entry.themes?.length > 0 && (
                          <span className="text-xs text-gray-400 mt-0.5 truncate block max-w-xs">
                            {entry.themes.slice(0, 3).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-500 hidden md:table-cell truncate max-w-[160px]">
                        {entry.funder ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-500 hidden lg:table-cell">{entry.lead_pi ?? '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-gray-500 hidden lg:table-cell tabular-nums">{entry.call_year ?? '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-gray-500 text-right hidden lg:table-cell whitespace-nowrap">
                        {formatAmount(entry.awarded_amount ?? entry.requested_amount, entry.currency) ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <div className="flex flex-col gap-1">
                          {entry.indexing_status === 'pending' || entry.indexing_status === 'processing' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium w-fit">
                              Indexing…
                            </span>
                          ) : entry.indexing_status === 'failed' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium w-fit" title={entry.indexing_error ?? undefined}>
                              Index failed
                            </span>
                          ) : (entry.section_count ?? 0) > 0 ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium w-fit">
                              {entry.section_count} sections
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                          {entry.style_indexed && entry.indexing_status === 'complete' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium w-fit">
                              Style
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {entry.outcome ? (
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${OUTCOME_STYLES[entry.outcome] ?? 'text-gray-500 bg-gray-100'}`}>
                            {OUTCOMES.find(o => o.value === entry.outcome)?.label ?? entry.outcome}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
