'use client';
import { useState } from 'react';
import { grants } from '@/lib/api';

export type TransitionType = 'submit' | 'accept' | 'reject' | 'archive';

interface StageTransitionModalProps {
  grantId: string;
  grantTitle: string;
  transitionType: TransitionType;
  requestedAmount?: number | null;
  onClose: () => void;
  onSuccess: (newStage: string) => void;
}

const ARCHIVE_OUTCOMES = [
  { value: 'awarded', label: 'Awarded' },
  { value: 'partially_funded', label: 'Partially funded' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'deferred', label: 'Deferred' },
];

const TRANSITION_CONFIG: Record<TransitionType, {
  title: string;
  description: string;
  confirmLabel: string;
  confirmClass: string;
  targetStage: string;
}> = {
  submit: {
    title: 'Mark as Submitted',
    description: 'Move this proposal to Pending Decisions. A snapshot will be saved to the archive for future reference.',
    confirmLabel: 'Mark Submitted',
    confirmClass: 'bg-blue-600 hover:bg-blue-700 text-white',
    targetStage: 'pending',
  },
  accept: {
    title: 'Mark as Accepted / Funded',
    description: 'Congratulations! Move this to Active Grants to begin project management.',
    confirmLabel: 'Mark Accepted',
    confirmClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    targetStage: 'active',
  },
  reject: {
    title: 'Mark as Rejected',
    description: 'Move this to the archive with outcome "Rejected". The workspace will be closed.',
    confirmLabel: 'Mark Rejected',
    confirmClass: 'bg-red-600 hover:bg-red-700 text-white',
    targetStage: 'rejected',
  },
  archive: {
    title: 'Move to Archive',
    description: 'Close this active grant and save a full record to the archive.',
    confirmLabel: 'Move to Archive',
    confirmClass: 'bg-gray-700 hover:bg-gray-800 text-white',
    targetStage: 'archived',
  },
};

export default function StageTransitionModal({
  grantId,
  grantTitle,
  transitionType,
  requestedAmount,
  onClose,
  onSuccess,
}: StageTransitionModalProps) {
  const config = TRANSITION_CONFIG[transitionType];

  const [notes, setNotes] = useState('');
  const [awardAmount, setAwardAmount] = useState(requestedAmount ? String(requestedAmount) : '');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [archiveOutcome, setArchiveOutcome] = useState('awarded');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { stage: config.targetStage };
      if (notes) payload.notes = notes;

      if (transitionType === 'accept') {
        const parsed = parseFloat(awardAmount.replace(/,/g, ''));
        if (!isNaN(parsed) && parsed > 0) payload.award_amount = parsed;
      }
      if (transitionType === 'reject' || transitionType === 'archive') {
        if (lessonsLearned) payload.lessons_learned = lessonsLearned;
      }
      if (transitionType === 'archive') {
        payload.outcome = archiveOutcome;
      }

      await grants.updateStage(grantId, payload);
      onSuccess(config.targetStage);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === 'string' ? msg : 'Failed to update stage. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{config.title}</h2>
            <p className="text-sm text-gray-500 mt-1 line-clamp-1">{grantTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors mt-0.5 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">{config.description}</p>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Accept: award amount */}
          {transitionType === 'accept' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Award amount (optional)
              </label>
              <input
                type="text"
                value={awardAmount}
                onChange={e => setAwardAmount(e.target.value)}
                placeholder="e.g. 250000"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-300"
              />
            </div>
          )}

          {/* Archive: outcome dropdown */}
          {transitionType === 'archive' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Outcome</label>
              <select
                value={archiveOutcome}
                onChange={e => setArchiveOutcome(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
              >
                {ARCHIVE_OUTCOMES.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Reject / Archive: lessons learned */}
          {(transitionType === 'reject' || transitionType === 'archive') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Lessons learned (optional)
              </label>
              <textarea
                value={lessonsLearned}
                onChange={e => setLessonsLearned(e.target.value)}
                placeholder="What worked, what didn't, reviewer feedback…"
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 resize-none placeholder-gray-300"
              />
            </div>
          )}

          {/* Notes — shown for all transitions */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              {transitionType === 'submit' ? 'Submission notes (optional)' : 'Notes (optional)'}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={
                transitionType === 'submit' ? 'e.g. Submitted via portal on…' :
                transitionType === 'accept' ? 'e.g. Start date, funder contact…' :
                transitionType === 'reject' ? 'e.g. Reason for rejection…' :
                'Internal notes…'
              }
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 resize-none placeholder-gray-300"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-xl disabled:opacity-50 transition-colors ${config.confirmClass}`}
            >
              {saving ? 'Saving…' : config.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
