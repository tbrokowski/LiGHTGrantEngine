'use client';
import { useState } from 'react';
import { opportunities } from '@/lib/api';
import type { Opportunity } from './types';

interface AddToShortlistModalProps {
  onClose: () => void;
  onAdded: (opportunity: Opportunity) => void;
}

const FIELD_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white disabled:bg-gray-50 disabled:text-gray-400';

const LABEL_CLS = 'block text-xs font-medium text-gray-500 mb-1.5';

export default function AddToShortlistModal({ onClose, onAdded }: AddToShortlistModalProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [funder, setFunder] = useState('');
  const [deadline, setDeadline] = useState('');
  const [awardMin, setAwardMin] = useState('');
  const [awardMax, setAwardMax] = useState('');
  const [description, setDescription] = useState('');

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function handleFetch() {
    if (!url.trim()) return;
    setFetching(true);
    setFetchError('');
    try {
      const { data } = await opportunities.scrapePreview(url.trim());
      if (data.error && data.error !== 'no_content') {
        setFetchError(`Could not fetch page: ${data.error}`);
      } else {
        if (data.description && !description) setDescription(data.description);
        // Attempt to extract a title from the first line of description if title is blank
        if (!title && data.description) {
          const firstLine = data.description.split('\n').find((l: string) => l.trim().startsWith('## '));
          if (firstLine) {
            setTitle(firstLine.replace(/^##\s*/, '').trim());
          }
        }
        if (!data.description && !data.short_summary) {
          setFetchError('Page fetched but no grant content was found. Please fill in the fields manually.');
        }
      }
    } catch {
      setFetchError('Failed to fetch the URL. Check the address and try again.');
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const payload: Record<string, unknown> = { title: title.trim() };
      if (funder.trim()) payload.funder = funder.trim();
      if (deadline) payload.deadline = deadline;
      if (awardMin) payload.award_min = parseFloat(awardMin.replace(/,/g, ''));
      if (awardMax) payload.award_max = parseFloat(awardMax.replace(/,/g, ''));
      if (description.trim()) payload.description = description.trim();
      if (url.trim()) payload.opportunity_url = url.trim();

      const createRes = await opportunities.create(payload);
      const newId: string = createRes.data.id;

      await opportunities.addToShortlist(newId);

      const newOpp: Opportunity = {
        id: newId,
        title: title.trim(),
        funder: funder.trim() || null,
        deadline: deadline || null,
        fit_score: null,
        priority: null,
        status: 'new',
        thematic_areas: [],
        award_min: awardMin ? parseFloat(awardMin.replace(/,/g, '')) : null,
        award_max: awardMax ? parseFloat(awardMax.replace(/,/g, '')) : null,
        currency: null,
        short_summary: null,
        description: description.trim() || null,
        has_description: Boolean(description.trim()),
        funder_logo_url: null,
        opportunity_url: url.trim() || null,
        is_read: true,
        fit_rationale: null,
        is_personal_shortlisted: true,
        is_on_org_shortlist: false,
      };

      onAdded(newOpp);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSaveError(typeof msg === 'string' ? msg : 'Failed to save opportunity. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between gap-4 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Add to Shortlist</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* URL + Fetch */}
          <div>
            <label className={LABEL_CLS}>URL <span className="text-gray-400 font-normal">(optional — paste to auto-fill)</span></label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://…"
                className={FIELD_CLS}
                disabled={fetching || saving}
              />
              <button
                type="button"
                onClick={handleFetch}
                disabled={!url.trim() || fetching || saving}
                className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {fetching ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            {fetchError && (
              <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{fetchError}</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className={LABEL_CLS}>Title <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Grant or program name"
              required
              className={FIELD_CLS}
              disabled={saving}
            />
          </div>

          {/* Funder */}
          <div>
            <label className={LABEL_CLS}>Funder</label>
            <input
              type="text"
              value={funder}
              onChange={e => setFunder(e.target.value)}
              placeholder="e.g. NIH, Wellcome Trust"
              className={FIELD_CLS}
              disabled={saving}
            />
          </div>

          {/* Deadline */}
          <div>
            <label className={LABEL_CLS}>Deadline</label>
            <input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className={FIELD_CLS}
              disabled={saving}
            />
          </div>

          {/* Award range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Award min</label>
              <input
                type="text"
                value={awardMin}
                onChange={e => setAwardMin(e.target.value)}
                placeholder="e.g. 50000"
                className={FIELD_CLS}
                disabled={saving}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Award max</label>
              <input
                type="text"
                value={awardMax}
                onChange={e => setAwardMax(e.target.value)}
                placeholder="e.g. 500000"
                className={FIELD_CLS}
                disabled={saving}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className={LABEL_CLS}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Paste or type grant details…"
              rows={5}
              className={`${FIELD_CLS} resize-y`}
              disabled={saving}
            />
          </div>

          {saveError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-shortlist-form"
            disabled={!title.trim() || saving}
            onClick={handleSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Adding…' : 'Add to Shortlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
