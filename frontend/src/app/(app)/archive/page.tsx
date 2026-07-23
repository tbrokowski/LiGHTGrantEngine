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
];

const OUTCOME_TOKENS: Record<string, { bg: string; color: string }> = {
  awarded:          { bg: 'var(--state-success-bg)', color: 'var(--state-success)' },
  rejected:         { bg: 'var(--state-danger-bg)',  color: 'var(--state-danger)' },
  pending:          { bg: 'var(--state-warning-bg)', color: 'var(--state-warning)' },
  withdrawn:        { bg: 'var(--surface-sunken)',   color: 'var(--ink-muted)' },
  resubmitted:      { bg: 'var(--state-info-bg)',    color: 'var(--state-info)' },
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
  inputRef: React.RefObject<HTMLInputElement>;
  accept: string;
  hint: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
        {label} {required && <span style={{ color: 'var(--state-danger)' }}>*</span>}
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
        className="w-full px-3 py-3 text-sm text-left transition-colors"
        style={{
          border: '1px dashed var(--rule-strong)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: file ? 'var(--ink-primary)' : 'var(--ink-faint)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-sunken)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {file ? file.name : 'Click to upload'}
      </button>
      <p className="text-[10px] mt-1" style={{ color: 'var(--ink-faint)' }}>{hint}</p>
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
    text_reuse_allowed: true,
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

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-sunken)',
    color: 'var(--ink-primary)',
    outline: 'none',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--surface-overlay)' }}>
      <div
        className="w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col"
        style={{
          background: 'var(--surface-panel)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--rule-subtle)',
          boxShadow: 'var(--shadow-floating)',
        }}
      >
        <div
          className="px-6 py-5 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--rule-subtle)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Add to Archive</h2>
          <button
            onClick={onClose}
            className="p-1 transition-colors"
            style={{ color: 'var(--ink-faint)', borderRadius: 'var(--radius-sm)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-muted)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form id="archive-form" onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <p
              className="text-sm px-3 py-2"
              style={{
                color: 'var(--state-danger)',
                background: 'var(--state-danger-bg)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {error}
            </p>
          )}
          {saving && (
            <div
              className="flex items-center gap-2.5 text-xs px-3 py-2.5"
              style={{
                color: 'var(--state-warning)',
                background: 'var(--state-warning-bg)',
                border: '1px solid var(--state-warning)',
                borderRadius: 'var(--radius-sm)',
                opacity: 0.8,
              }}
            >
              <svg className="w-3.5 h-3.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading documents… this may take a moment for large files.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Title <span style={{ color: 'var(--state-danger)' }}>*</span>
            </label>
            <input
              ref={firstRef}
              type="text"
              value={form.title}
              onChange={e => setField('title', e.target.value)}
              placeholder="Grant or proposal title"
              className="w-full px-3 py-2 text-sm"
              style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Funder</label>
              <input
                type="text"
                value={form.funder}
                onChange={e => setField('funder', e.target.value)}
                placeholder="Organization"
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Lead PI</label>
              <input
                type="text"
                value={form.lead_pi}
                onChange={e => setField('lead_pi', e.target.value)}
                placeholder="PI name"
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Call year</label>
              <input
                type="number"
                value={form.call_year}
                onChange={e => setField('call_year', e.target.value)}
                placeholder={String(new Date().getFullYear())}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Submission date</label>
              <input
                type="date"
                value={form.submission_date}
                onChange={e => setField('submission_date', e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Outcome</label>
            <select
              value={form.outcome}
              onChange={e => setField('outcome', e.target.value)}
              className="w-full px-3 py-2 text-sm"
              style={inputStyle}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
            >
              {OUTCOMES.filter(o => o.value).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={e => setField('currency', e.target.value)}
                placeholder="USD"
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Requested</label>
              <input
                type="text"
                value={form.requested_amount}
                onChange={e => setField('requested_amount', e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Awarded</label>
              <input
                type="text"
                value={form.awarded_amount}
                onChange={e => setField('awarded_amount', e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
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
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink-secondary)' }}>
              <input
                type="checkbox"
                checked={form.ai_retrieval_allowed}
                onChange={e => setField('ai_retrieval_allowed', e.target.checked)}
                className="rounded"
              />
              Allow AI retrieval from this proposal
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink-secondary)' }}>
              <input
                type="checkbox"
                checked={form.text_reuse_allowed}
                onChange={e => setField('text_reuse_allowed', e.target.checked)}
                className="rounded"
              />
              Allow direct text reuse (otherwise paraphrase-only)
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Lessons learned</label>
            <textarea
              value={form.lessons_learned}
              onChange={e => setField('lessons_learned', e.target.value)}
              rows={2}
              placeholder="What worked, what didn't…"
              className="w-full px-3 py-2 text-sm resize-none"
              style={{ ...inputStyle, outline: 'none' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              rows={2}
              placeholder="Internal notes…"
              className="w-full px-3 py-2 text-sm resize-none"
              style={{ ...inputStyle, outline: 'none' }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
            />
          </div>
        </form>
        <div className="px-6 pb-5 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm transition-colors"
            style={{
              color: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="archive-form"
            disabled={saving}
            className="flex-1 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            style={{
              background: 'var(--accent-primary)',
              color: 'var(--ink-inverse)',
              borderRadius: 'var(--radius-sm)',
            }}
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
  // `silent` refreshes the data in place without flipping the full-page loading
  // state — used by the indexing poller so the table doesn't flash to "Loading…"
  // every few seconds while a background index runs.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return archive.list(search ? { search } : {})
      .then(r => setEntries(r.data))
      .catch(console.error)
      .finally(() => { if (!silent) setLoading(false); });
  }, [search]);

  useEffect(() => { load(); }, [load]);

  // Poll for indexing progress, but silently (no loading flash) and only for a
  // bounded window — a single archive stuck in 'processing' shouldn't make the
  // list re-fetch forever. The backend watchdog re-queues genuinely stale rows.
  useEffect(() => {
    const indexing = entries.some(
      e => e.indexing_status === 'pending' || e.indexing_status === 'processing'
    );
    if (!indexing) return;
    let polls = 0;
    const MAX_POLLS = 40; // ~40 × 6s ≈ 4 min, then stop nagging
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) { clearInterval(timer); return; }
      load(true);
    }, 6000);
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
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--surface-base)' }}>
      {showModal && (
        <NewArchiveModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Success banner */}
      {successMessage && (
        <div
          className="mx-6 mt-4 flex items-center justify-between px-4 py-3 text-sm shrink-0"
          style={{
            background: 'var(--state-success-bg)',
            border: '1px solid var(--state-success)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--state-success)',
          }}
        >
          <span>{successMessage}</span>
          <button
            onClick={() => setSuccessMessage('')}
            style={{ color: 'var(--state-success)', opacity: 0.7 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="px-8 pt-6 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Grant Archive</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>Institutional memory — all past submissions</p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' && (
            <input
              type="text"
              placeholder="Search archive…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 text-sm w-52"
              style={{
                border: '1px solid var(--rule-subtle)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-sunken)',
                color: 'var(--ink-primary)',
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
            />
          )}
          <ViewToggle view={viewMode} onChange={setViewMode} />
          {canUpload && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap"
              style={{
                background: 'var(--accent-primary)',
                color: 'var(--ink-inverse)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add entry
            </button>
          )}
        </div>
      </div>

      {/* ── Graph view ───────────────────────────────────────────────────────── */}
      {viewMode === 'graph' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Graph filter bar */}
          <div className="px-8 pb-3 shrink-0 flex items-center gap-3 flex-wrap">
            <ArchiveGraphFilters
              filters={graphFilters}
              onChange={handleGraphFiltersChange}
              funders={allFunders}
              years={allYears}
              themes={allThemes}
            />
            {graphLoading && (
              <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--ink-faint)' }}>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading graph…
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
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
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Outcome filter tabs */}
          <div className="flex overflow-x-auto shrink-0 px-4" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            {OUTCOMES.map(o => {
              const count = outcomeCounts[o.value] ?? 0;
              if (!o.value && !loading && entries.length === 0) return null;
              const isActive = outcomeFilter === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setOutcomeFilter(o.value)}
                  className="relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
                  style={{ color: isActive ? 'var(--ink-primary)' : 'var(--ink-faint)' }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--ink-secondary)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--ink-faint)'; }}
                >
                  {o.label}
                  {count > 0 && (
                    <span className="mono-data text-[10px]" style={{ color: isActive ? 'var(--ink-muted)' : 'var(--ink-faint)' }}>
                      {count}
                    </span>
                  )}
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-0.5"
                      style={{ background: 'var(--accent-primary)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4">
            <table className="w-full text-sm">
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
                  <th className="text-left px-4 py-3 ledger-label">Title</th>
                  <th className="text-left px-4 py-3 ledger-label hidden md:table-cell">Funder</th>
                  <th className="text-left px-4 py-3 ledger-label hidden lg:table-cell">PI</th>
                  <th className="text-left px-4 py-3 ledger-label hidden lg:table-cell">Year</th>
                  <th className="text-right px-4 py-3 ledger-label hidden lg:table-cell">Amount</th>
                  <th className="text-left px-4 py-3 ledger-label hidden md:table-cell">AI</th>
                  <th className="text-left px-4 py-3 ledger-label">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center">
                      <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>
                        {search ? 'No matches found.' : 'Archive is empty.'}
                      </p>
                      {!search && (
                        <button
                          onClick={() => setShowModal(true)}
                          className="text-xs underline underline-offset-2 mt-1"
                          style={{ color: 'var(--ink-faint)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-secondary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
                        >
                          Add the first entry
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map(entry => (
                    <tr
                      key={entry.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--rule-subtle)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--selection-bg)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/archive/${entry.id}`}
                          className="font-medium block truncate max-w-xs"
                          style={{ color: 'var(--ink-primary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-secondary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-primary)')}
                        >
                          {entry.title}
                        </Link>
                        {entry.themes?.length > 0 && (
                          <span className="mono-data text-[11px] mt-0.5 truncate block max-w-xs" style={{ color: 'var(--ink-faint)' }}>
                            {entry.themes.slice(0, 3).join('  ·  ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm hidden md:table-cell truncate max-w-[160px]" style={{ color: 'var(--ink-muted)' }}>
                        {entry.funder ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 text-sm hidden lg:table-cell" style={{ color: 'var(--ink-muted)' }}>
                        {entry.lead_pi ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        <span className="mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                          {entry.call_year ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right hidden lg:table-cell whitespace-nowrap">
                        <span className="mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                          {formatAmount(entry.awarded_amount ?? entry.requested_amount, entry.currency) ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <div className="flex flex-col gap-1">
                          {entry.indexing_status === 'pending' || entry.indexing_status === 'processing' ? (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)] w-fit"
                              style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)' }}
                            >
                              Indexing…
                            </span>
                          ) : entry.indexing_status === 'failed' ? (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)] w-fit"
                              style={{ background: 'var(--state-danger-bg)', color: 'var(--state-danger)' }}
                              title={entry.indexing_error ?? undefined}
                            >
                              Index failed
                            </span>
                          ) : (entry.section_count ?? 0) > 0 ? (
                            <span
                              className="mono-data text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)] w-fit"
                              style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
                            >
                              {entry.section_count} sections
                            </span>
                          ) : (
                            <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>—</span>
                          )}
                          {entry.style_indexed && entry.indexing_status === 'complete' && (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)] w-fit"
                              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)', border: '1px solid var(--rule-subtle)' }}
                            >
                              Style
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {entry.outcome ? (() => {
                          const tok = OUTCOME_TOKENS[entry.outcome] ?? { bg: 'var(--surface-sunken)', color: 'var(--ink-muted)' };
                          return (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                              style={{ background: tok.bg, color: tok.color }}
                            >
                              {OUTCOMES.find(o => o.value === entry.outcome)?.label ?? entry.outcome}
                            </span>
                          );
                        })() : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
