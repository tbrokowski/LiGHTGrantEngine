'use client';
import { useState } from 'react';
import PartnerTagChip from './PartnerTagChip';

const PRESET_TAGS = ['PI', 'co-I', 'industry', 'government', 'ngo', 'academia', 'funder', 'advisor', 'reviewer'];
const PRESET_PROJECT_TYPES = ['AI/ML', 'health', 'climate', 'education', 'agriculture', 'water', 'energy', 'finance', 'governance', 'gender'];

export interface PartnerFormData {
  name: string;
  email: string;
  phone: string;
  organization: string;
  title: string;
  linkedin_url: string;
  website: string;
  tags: string[];
  project_types: string[];
  status: string;
  notes: string;
}

interface PartnerFormProps {
  initial?: Partial<PartnerFormData>;
  onSubmit: (data: PartnerFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

const EMPTY: PartnerFormData = {
  name: '', email: '', phone: '', organization: '', title: '',
  linkedin_url: '', website: '', tags: [], project_types: [],
  status: 'active', notes: '',
};

export default function PartnerForm({ initial, onSubmit, onCancel, submitLabel = 'Save' }: PartnerFormProps) {
  const [form, setForm] = useState<PartnerFormData>({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [ptInput, setPtInput] = useState('');
  const [error, setError] = useState('');

  function set(field: keyof PartnerFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function addTag(tag: string, field: 'tags' | 'project_types') {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setForm(prev => ({
      ...prev,
      [field]: prev[field].includes(trimmed) ? prev[field] : [...prev[field], trimmed],
    }));
    if (field === 'tags') setTagInput('');
    else setPtInput('');
  }

  function removeTag(tag: string, field: 'tags' | 'project_types') {
    setForm(prev => ({ ...prev, [field]: prev[field].filter(t => t !== tag) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit(form);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div>
      )}

      {/* Core info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.name} onChange={e => set('name', e.target.value)} required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.organization} onChange={e => set('organization', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title / Role</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.title} onChange={e => set('title', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.email} onChange={e => set('email', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.phone} onChange={e => set('phone', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.status} onChange={e => set('status', e.target.value)}
          >
            <option value="active">Active</option>
            <option value="prospect">Prospect</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn URL</label>
          <input
            type="url"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
          <input
            type="url"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.website} onChange={e => set('website', e.target.value)}
          />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Partner Tags</label>
        <div className="flex flex-wrap gap-1 mb-2">
          {form.tags.map(t => (
            <PartnerTagChip key={t} tag={t} onRemove={() => removeTag(t, 'tags')} />
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Add tag..."
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput, 'tags'); }}}
          />
          <button type="button" onClick={() => addTag(tagInput, 'tags')}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Add</button>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {PRESET_TAGS.filter(t => !form.tags.includes(t)).map(t => (
            <button key={t} type="button" onClick={() => addTag(t, 'tags')}
              className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
              + {t}
            </button>
          ))}
        </div>
      </div>

      {/* Project types */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Project Types</label>
        <div className="flex flex-wrap gap-1 mb-2">
          {form.project_types.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-800 font-medium">
              {t}
              <button type="button" onClick={() => removeTag(t, 'project_types')} className="hover:opacity-70">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Add project type..."
            value={ptInput}
            onChange={e => setPtInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(ptInput, 'project_types'); }}}
          />
          <button type="button" onClick={() => addTag(ptInput, 'project_types')}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Add</button>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {PRESET_PROJECT_TYPES.filter(t => !form.project_types.includes(t)).map(t => (
            <button key={t} type="button" onClick={() => addTag(t, 'project_types')}
              className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
              + {t}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Any additional context about this partner..."
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50 border border-gray-200">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
