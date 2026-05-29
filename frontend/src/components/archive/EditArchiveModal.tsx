'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { archive } from '@/lib/api';

const OUTCOMES = [
  { value: 'pending', label: 'Pending' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'partially_funded', label: 'Partially funded' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'not_submitted', label: 'Not submitted' },
  { value: 'resubmitted', label: 'Resubmitted' },
];

const DOC_TYPES = [
  { value: 'full_proposal', label: 'Submitted proposal' },
  { value: 'call_document', label: 'Call / RFP' },
  { value: 'budget', label: 'Budget' },
  { value: 'review_feedback', label: 'Reviewer feedback' },
];

function formatApiError(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'object' && item !== null && 'msg' in item) {
          return String((item as { msg: string }).msg);
        }
        return String(item);
      })
      .join(' ');
  }
  return 'Failed to save changes. Please try again.';
}

const FILE_ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BUDGET_ACCEPT = `${FILE_ACCEPT},.xlsx,.xls,.csv`;

export interface ArchiveDetailForEdit {
  id: string;
  title: string;
  funder?: string;
  lead_pi?: string;
  call_year?: number;
  submission_date?: string;
  decision_date?: string;
  submitted?: boolean;
  outcome?: string;
  requested_amount?: number;
  awarded_amount?: number;
  currency?: string;
  notes?: string;
  lessons_learned?: string;
  reviewer_feedback?: string;
  outcome_notes?: string;
  ai_retrieval_allowed?: boolean;
  text_reuse_allowed?: boolean;
}

interface EditForm {
  title: string;
  funder: string;
  lead_pi: string;
  call_year: string;
  submission_date: string;
  decision_date: string;
  submitted: boolean;
  outcome: string;
  requested_amount: string;
  awarded_amount: string;
  currency: string;
  notes: string;
  lessons_learned: string;
  reviewer_feedback: string;
  ai_retrieval_allowed: boolean;
  text_reuse_allowed: boolean;
}

interface NewDoc {
  file: File;
  document_type: string;
}

function toFormState(entry: ArchiveDetailForEdit): EditForm {
  return {
    title: entry.title ?? '',
    funder: entry.funder ?? '',
    lead_pi: entry.lead_pi ?? '',
    call_year: entry.call_year != null ? String(entry.call_year) : '',
    submission_date: entry.submission_date ? entry.submission_date.slice(0, 10) : '',
    decision_date: entry.decision_date ? entry.decision_date.slice(0, 10) : '',
    submitted: entry.submitted ?? false,
    outcome: entry.outcome ?? 'pending',
    requested_amount: entry.requested_amount != null ? String(entry.requested_amount) : '',
    awarded_amount: entry.awarded_amount != null ? String(entry.awarded_amount) : '',
    currency: entry.currency ?? 'USD',
    notes: entry.notes ?? '',
    lessons_learned: entry.lessons_learned ?? '',
    reviewer_feedback: entry.reviewer_feedback ?? entry.outcome_notes ?? '',
    ai_retrieval_allowed: entry.ai_retrieval_allowed ?? true,
    text_reuse_allowed: entry.text_reuse_allowed ?? false,
  };
}

interface Props {
  entry: ArchiveDetailForEdit;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditArchiveModal({ entry, onClose, onSaved }: Props) {
  const [form, setForm] = useState<EditForm>(() => toFormState(entry));
  const [newDocs, setNewDocs] = useState<NewDoc[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  function setField<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function addDoc() {
    setNewDocs(prev => [...prev, { file: null as unknown as File, document_type: 'full_proposal' }]);
  }

  function removeDoc(idx: number) {
    setNewDocs(prev => prev.filter((_, i) => i !== idx));
  }

  function setDocFile(idx: number, file: File | null) {
    setNewDocs(prev => prev.map((d, i) => i === idx ? { ...d, file: file as File } : d));
  }

  function setDocType(idx: number, document_type: string) {
    setNewDocs(prev => prev.map((d, i) => i === idx ? { ...d, document_type } : d));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }

    const incompleteDoc = newDocs.find(d => !d.file);
    if (incompleteDoc) { setError('Please select a file for each document you added, or remove it.'); return; }

    setSaving(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        submitted: form.submitted,
        outcome: form.outcome || 'pending',
        ai_retrieval_allowed: form.ai_retrieval_allowed,
        text_reuse_allowed: form.text_reuse_allowed,
      };
      if (form.funder) payload.funder = form.funder;
      else payload.funder = null;
      if (form.lead_pi) payload.lead_pi = form.lead_pi;
      else payload.lead_pi = null;
      if (form.call_year) payload.call_year = parseInt(form.call_year, 10);
      else payload.call_year = null;
      if (form.submission_date) payload.submission_date = form.submission_date;
      else payload.submission_date = null;
      if (form.decision_date) payload.decision_date = form.decision_date;
      else payload.decision_date = null;
      if (form.requested_amount) payload.requested_amount = parseFloat(form.requested_amount.replace(/,/g, ''));
      else payload.requested_amount = null;
      if (form.awarded_amount) payload.awarded_amount = parseFloat(form.awarded_amount.replace(/,/g, ''));
      else payload.awarded_amount = null;
      if (form.currency) payload.currency = form.currency;
      payload.notes = form.notes || null;
      payload.lessons_learned = form.lessons_learned || null;
      payload.reviewer_feedback = form.reviewer_feedback || null;

      await archive.update(entry.id, payload);

      for (const doc of newDocs) {
        const fd = new FormData();
        fd.append('file', doc.file);
        fd.append('document_type', doc.document_type);
        await archive.uploadDocument(entry.id, fd);
      }

      setSaving(false);
      onSaved();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(formatApiError(detail));
      setSaving(false);
    }
  }

  const inputClass = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400 placeholder-gray-300';
  const labelClass = 'block text-xs font-medium text-gray-500 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Edit Archive Entry</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form id="edit-archive-form" onSubmit={handleSave} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Title */}
          <div>
            <label className={labelClass}>Title <span className="text-red-400">*</span></label>
            <input
              ref={titleRef}
              type="text"
              value={form.title}
              onChange={e => setField('title', e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Funder + Lead PI */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Funder</label>
              <input
                type="text"
                value={form.funder}
                onChange={e => setField('funder', e.target.value)}
                placeholder="Organization"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Lead PI</label>
              <input
                type="text"
                value={form.lead_pi}
                onChange={e => setField('lead_pi', e.target.value)}
                placeholder="PI name"
                className={inputClass}
              />
            </div>
          </div>

          {/* Call year + Submission date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Call year</label>
              <input
                type="number"
                value={form.call_year}
                onChange={e => setField('call_year', e.target.value)}
                placeholder={String(new Date().getFullYear())}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Submission date</label>
              <input
                type="date"
                value={form.submission_date}
                onChange={e => setField('submission_date', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Decision date + Submitted */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Decision date</label>
              <input
                type="date"
                value={form.decision_date}
                onChange={e => setField('decision_date', e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col justify-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.submitted}
                  onChange={e => setField('submitted', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-gray-700"
                />
                <span className="text-sm text-gray-700">Proposal submitted</span>
              </label>
            </div>
          </div>

          {/* Outcome */}
          <div>
            <label className={labelClass}>Outcome</label>
            <select
              value={form.outcome}
              onChange={e => setField('outcome', e.target.value)}
              className={`${inputClass} bg-white`}
            >
              {OUTCOMES.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={e => setField('currency', e.target.value)}
                placeholder="USD"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Requested</label>
              <input
                type="text"
                value={form.requested_amount}
                onChange={e => setField('requested_amount', e.target.value)}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Awarded</label>
              <input
                type="text"
                value={form.awarded_amount}
                onChange={e => setField('awarded_amount', e.target.value)}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>

          {/* Reviewer feedback */}
          <div>
            <label className={labelClass}>Reviewer feedback / call response</label>
            <textarea
              rows={3}
              value={form.reviewer_feedback}
              onChange={e => setField('reviewer_feedback', e.target.value)}
              placeholder="Panel comments, call response letter, or reviewer notes…"
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Lessons learned */}
          <div>
            <label className={labelClass}>Lessons learned</label>
            <textarea
              rows={3}
              value={form.lessons_learned}
              onChange={e => setField('lessons_learned', e.target.value)}
              placeholder="What would you do differently?"
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Notes */}
          <div>
            <label className={labelClass}>Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="Internal notes…"
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* AI permissions */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.ai_retrieval_allowed}
                onChange={e => setField('ai_retrieval_allowed', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 accent-gray-700"
              />
              <span className="text-sm text-gray-700">Allow AI retrieval</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.text_reuse_allowed}
                onChange={e => setField('text_reuse_allowed', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 accent-gray-700"
              />
              <span className="text-sm text-gray-700">Allow text reuse</span>
            </label>
          </div>

          {/* Add documents */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500">Add documents</span>
              <button
                type="button"
                onClick={addDoc}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                + Add file
              </button>
            </div>
            {newDocs.length === 0 && (
              <p className="text-xs text-gray-400">No new documents to upload.</p>
            )}
            <div className="space-y-3">
              {newDocs.map((doc, idx) => (
                <DocUploadRow
                  key={idx}
                  doc={doc}
                  onFileChange={f => setDocFile(idx, f)}
                  onTypeChange={t => setDocType(idx, t)}
                  onRemove={() => removeDoc(idx)}
                  budgetAccept={BUDGET_ACCEPT}
                  fileAccept={FILE_ACCEPT}
                />
              ))}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-archive-form"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocUploadRow({
  doc,
  onFileChange,
  onTypeChange,
  onRemove,
  fileAccept,
  budgetAccept,
}: {
  doc: NewDoc;
  onFileChange: (f: File | null) => void;
  onTypeChange: (t: string) => void;
  onRemove: () => void;
  fileAccept: string;
  budgetAccept: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = doc.document_type === 'budget' ? budgetAccept : fileAccept;

  return (
    <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
      <div className="flex-1 space-y-2">
        <select
          value={doc.document_type}
          onChange={e => onTypeChange(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          {DOC_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={e => onFileChange(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full border border-dashed border-gray-300 rounded-lg px-2.5 py-2 text-xs text-left hover:border-gray-400 hover:bg-white transition-colors"
        >
          {doc.file
            ? <span className="text-gray-800 truncate block">{doc.file.name}</span>
            : <span className="text-gray-400">Click to upload</span>
          }
        </button>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors shrink-0 mt-0.5"
        title="Remove"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
