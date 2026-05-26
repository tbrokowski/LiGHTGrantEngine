'use client';

import { useEffect, useState } from 'react';
import { organizations, users } from '@/lib/api';

interface OrgSource {
  id: string;
  name: string;
  url?: string;
  source_type: string;
  category?: string;
  is_enabled: boolean;
  is_high_priority?: boolean;
}

interface GrantProfile {
  institution_name?: string;
  keywords?: string[];
  geographies?: string[];
  projects?: string;
  excluded_keywords?: string[];
}

interface GrantFiltersPanelProps {
  institutionId: string;
  isOrgAdmin: boolean;
}

function TagInput({
  label,
  hint,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  function addTag() {
    const val = input.trim();
    if (!val || tags.includes(val)) return;
    onChange([...tags, val]);
    setInput('');
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
            {t}
            <button type="button" onClick={() => onChange(tags.filter(x => x !== t))} className="text-blue-400 hover:text-blue-700">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          placeholder={placeholder}
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="button" onClick={addTag} className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50">Add</button>
      </div>
    </div>
  );
}

export function GrantFiltersPanel({ institutionId, isOrgAdmin }: GrantFiltersPanelProps) {
  const [orgProfile, setOrgProfile] = useState<GrantProfile>({});
  const [personalKeywords, setPersonalKeywords] = useState<string[]>([]);
  const [personalExcluded, setPersonalExcluded] = useState<string[]>([]);
  const [orgSources, setOrgSources] = useState<OrgSource[]>([]);
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [preseedStatus, setPreseedStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    organizations.getGrantProfile(institutionId).then(r => setOrgProfile(r.data ?? {})).catch(() => {});
    users.getGrantPreferences().then(r => {
      setPersonalKeywords(r.data?.keywords ?? []);
      setPersonalExcluded(r.data?.excluded_keywords ?? []);
    }).catch(() => {});
    organizations.listOrgSources(institutionId).then(r => setOrgSources(r.data ?? [])).catch(() => {});
    organizations.preseedStatus(institutionId).then(r => setPreseedStatus(r.data?.status ?? null)).catch(() => {});
  }, [institutionId]);

  async function saveOrgProfile() {
    setSavingOrg(true);
    setMessage(null);
    try {
      await organizations.updateGrantProfile(institutionId, orgProfile);
      setMessage('Organization filters saved. Rescoring grants…');
    } finally {
      setSavingOrg(false);
    }
  }

  async function savePersonal() {
    setSavingPersonal(true);
    try {
      await users.updateGrantPreferences({ keywords: personalKeywords, excluded_keywords: personalExcluded });
      setMessage('Personal keyword filters saved.');
    } finally {
      setSavingPersonal(false);
    }
  }

  async function toggleSource(sourceId: string, enabled: boolean) {
    await organizations.toggleOrgSource(institutionId, sourceId, !enabled);
    setOrgSources(prev => prev.map(s => s.id === sourceId ? { ...s, is_enabled: !enabled } : s));
  }

  return (
    <div className="space-y-8 mb-10">
      {preseedStatus === 'running' && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Preparing your grant feed from the global pool…
        </div>
      )}
      {message && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">{message}</div>
      )}

      {isOrgAdmin && (
        <section className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Organization filters</h3>
            <p className="text-xs text-gray-400 mt-0.5">Frozen for all members. Used to score and surface grants for your team.</p>
          </div>
          <TagInput
            label="Keywords & themes"
            hint="e.g. AI for health, maternal health, Mamai"
            tags={orgProfile.keywords ?? []}
            onChange={keywords => setOrgProfile(p => ({ ...p, keywords }))}
            placeholder="Add keyword…"
          />
          <TagInput
            label="Geographies"
            tags={orgProfile.geographies ?? []}
            onChange={geographies => setOrgProfile(p => ({ ...p, geographies }))}
            placeholder="e.g. sub-Saharan Africa"
          />
          <TagInput
            label="Excluded keywords"
            tags={orgProfile.excluded_keywords ?? []}
            onChange={excluded_keywords => setOrgProfile(p => ({ ...p, excluded_keywords }))}
            placeholder="e.g. agriculture"
          />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Team / project context</label>
            <textarea
              value={orgProfile.projects ?? ''}
              onChange={e => setOrgProfile(p => ({ ...p, projects: e.target.value }))}
              rows={3}
              placeholder="Describe active projects (Mamai, federated learning, etc.) for AI summaries"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={saveOrgProfile}
            disabled={savingOrg}
            className="text-sm px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {savingOrg ? 'Saving…' : 'Save organization filters'}
          </button>
        </section>
      )}

      <section className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">My keyword filters</h3>
          <p className="text-xs text-gray-400 mt-0.5">Personal add-ons on top of org filters. Only affects your view.</p>
        </div>
        <TagInput
          label="Personal keywords"
          tags={personalKeywords}
          onChange={setPersonalKeywords}
          placeholder="e.g. ultrasound, POCUS"
        />
        <TagInput
          label="Personal excluded keywords"
          tags={personalExcluded}
          onChange={setPersonalExcluded}
          placeholder="Hide grants matching…"
        />
        <button
          onClick={savePersonal}
          disabled={savingPersonal}
          className="text-sm px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {savingPersonal ? 'Saving…' : 'Save my filters'}
        </button>
      </section>

      <section className="border border-gray-200 rounded-lg p-5 bg-white">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Funding sources</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Global catalog from grant_funding_portals. {isOrgAdmin ? 'Enable or disable sources for your organization.' : 'Your org admin manages which sources are active.'}
          </p>
        </div>
        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {orgSources.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">Loading sources…</p>
          ) : orgSources.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                {s.category && <p className="text-xs text-gray-400">{s.category}</p>}
              </div>
              {isOrgAdmin ? (
                <button
                  onClick={() => toggleSource(s.id, s.is_enabled)}
                  className={`text-xs px-2.5 py-1 rounded-md border shrink-0 ${
                    s.is_enabled
                      ? 'border-green-200 text-green-700 bg-green-50 hover:bg-green-100'
                      : 'border-gray-200 text-gray-500 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  {s.is_enabled ? 'Enabled' : 'Disabled'}
                </button>
              ) : (
                <span className={`text-xs px-2 py-0.5 rounded ${s.is_enabled ? 'text-green-700 bg-green-50' : 'text-gray-400 bg-gray-50'}`}>
                  {s.is_enabled ? 'Active' : 'Off'}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
