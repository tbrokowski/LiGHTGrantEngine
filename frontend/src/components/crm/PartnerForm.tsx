'use client';
import { useState } from 'react';
import PartnerTagChip from './PartnerTagChip';

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
  orcid?: string;
  google_scholar_id?: string;
  department?: string;
  country?: string;
  city?: string;
  relationship_stage?: string;
}

interface PartnerFormProps {
  initial?: Partial<PartnerFormData>;
  onSubmit: (data: PartnerFormData) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function PartnerForm({ initial, onSubmit, onCancel, submitLabel = 'Save' }: PartnerFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [organization, setOrganization] = useState(initial?.organization ?? '');
  const [department, setDepartment] = useState(initial?.department ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [linkedin, setLinkedin] = useState(initial?.linkedin_url ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [orcid, setOrcid] = useState(initial?.orcid ?? '');
  const [googleScholar, setGoogleScholar] = useState(initial?.google_scholar_id ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [projectTypes, setProjectTypes] = useState<string[]>(initial?.project_types ?? []);
  const [ptInput, setPtInput] = useState('');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [stage, setStage] = useState(initial?.relationship_stage ?? 'prospect');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);

  function addTag(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.trim();
      if (val && !tags.includes(val)) setTags([...tags, val]);
      setTagInput('');
    }
  }

  function addPt(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = ptInput.trim();
      if (val && !projectTypes.includes(val)) setProjectTypes([...projectTypes, val]);
      setPtInput('');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        name, email, phone, organization, title,
        linkedin_url: linkedin, website, tags, project_types: projectTypes,
        status, notes, orcid: orcid || undefined, google_scholar_id: googleScholar || undefined,
        department: department || undefined, country: country || undefined, city: city || undefined,
        relationship_stage: stage,
      });
    } finally { setSaving(false); }
  }

  const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Core info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Full name *</label>
          <input value={name} onChange={e => setName(e.target.value)} required className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Professor, Dr., etc." className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Organization</label>
          <input value={organization} onChange={e => setOrganization(e.target.value)} className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
          <input value={department} onChange={e => setDepartment(e.target.value)} className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Country</label>
          <input value={country} onChange={e => setCountry(e.target.value)} className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">City</label>
          <input value={city} onChange={e => setCity(e.target.value)} className={field} />
        </div>
      </div>

      {/* Academic IDs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ORCID</label>
          <input value={orcid} onChange={e => setOrcid(e.target.value)} placeholder="0000-0000-0000-0000" className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Google Scholar ID</label>
          <input value={googleScholar} onChange={e => setGoogleScholar(e.target.value)} placeholder="xxxxxxxxxxxx" className={field} />
        </div>
      </div>

      {/* Links */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">LinkedIn</label>
          <input value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" className={field} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Website</label>
          <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" className={field} />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Expertise tags</label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {tags.map(t => (
            <PartnerTagChip key={t} tag={t} onRemove={() => setTags(tags.filter(x => x !== t))} />
          ))}
        </div>
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={addTag}
          placeholder="Type and press Enter to add tags…"
          className={field}
        />
      </div>

      {/* Project types */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Project types</label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {projectTypes.map(t => (
            <PartnerTagChip key={t} tag={t} color="indigo" onRemove={() => setProjectTypes(projectTypes.filter(x => x !== t))} />
          ))}
        </div>
        <input
          value={ptInput}
          onChange={e => setPtInput(e.target.value)}
          onKeyDown={addPt}
          placeholder="Type and press Enter to add project types…"
          className={field}
        />
      </div>

      {/* Status + Stage */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className={field}>
            <option value="active">Active</option>
            <option value="prospect">Prospect</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Relationship stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)} className={field}>
            <option value="prospect">Prospect</option>
            <option value="qualified">Qualified</option>
            <option value="engaged">Engaged</option>
            <option value="collaborating">Collaborating</option>
            <option value="alumni">Alumni</option>
          </select>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className={`${field} resize-none`} placeholder="Free-form notes…" />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-100">
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="flex-1 text-sm py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving}
          className="flex-1 text-sm py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
