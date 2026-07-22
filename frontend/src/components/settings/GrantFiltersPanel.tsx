'use client';

import { useEffect, useState, useCallback } from 'react';
import { organizations, users, sources, admin } from '@/lib/api';

interface OrgSource {
  id: string;
  name: string;
  url?: string;
  source_type: string;
  category?: string;
  is_enabled: boolean;
  is_high_priority?: boolean;
}

interface ScanRun {
  id: string;
  source_name: string;
  started_at: string | null;
  status: string;
  records_found: number | null;
  new_opportunities: number | null;
  errors: string[];
  log_summary: string | null;
}

interface ScanSummary {
  sources_by_status: Record<string, number>;
  total_opportunities: number;
  running_scans: number;
  recent_errors_24h: number;
}

interface PriorityFunderGroup {
  name: string;
  funders: string[];
}

interface GrantProfile {
  institution_name?: string;
  keywords?: string[];
  geographies?: string[];
  projects?: string;
  excluded_keywords?: string[];
  priority_funders?: PriorityFunderGroup[];
  [key: string]: unknown;
}

interface GrantFiltersPanelProps {
  institutionId: string;
  isOrgAdmin: boolean;
}

function ReadOnlyTagList({
  label,
  tags,
  emptyText = 'None set',
}: {
  label: string;
  tags: string[];
  emptyText?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {tags.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
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

function PriorityFunderGroupsEditor({
  groups,
  onChange,
}: {
  groups: PriorityFunderGroup[];
  onChange: (groups: PriorityFunderGroup[]) => void;
}) {
  const [newGroupName, setNewGroupName] = useState('');

  function addGroup() {
    const name = newGroupName.trim();
    if (!name || groups.some(g => g.name === name)) return;
    onChange([...groups, { name, funders: [] }]);
    setNewGroupName('');
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Priority funder groups</label>
      <p className="text-xs text-gray-400 mb-2">
        Named groups of funders (e.g. &quot;Tier 1&quot;) to quickly filter the opportunity list by.
      </p>
      <div className="space-y-3 mb-3">
        {groups.map(group => (
          <div key={group.name} className="border border-gray-200 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700">{group.name}</span>
              <button
                type="button"
                onClick={() => onChange(groups.filter(g => g.name !== group.name))}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                Remove group
              </button>
            </div>
            <TagInput
              label="Funders"
              tags={group.funders}
              onChange={funders => onChange(groups.map(g => g.name === group.name ? { ...g, funders } : g))}
              placeholder="e.g. NIH, Wellcome Trust"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={newGroupName}
          onChange={e => setNewGroupName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } }}
          placeholder="New group name (e.g. Tier 1 funders)"
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="button" onClick={addGroup} className="text-sm px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50">
          Add group
        </button>
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
  // Data management (admin-only)
  const [refreshing, setRefreshing] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [scanBanner, setScanBanner] = useState('');
  const [scanLogs, setScanLogs] = useState<ScanRun[]>([]);
  const [showScanLogs, setShowScanLogs] = useState(false);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [runningSources, setRunningSources] = useState<Record<string, boolean>>({});
  const [sourceRunResults, setSourceRunResults] = useState<Record<string, 'queued' | 'error'>>({});

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

  const loadScanStatus = useCallback(async () => {
    try {
      const [runsRes, summaryRes] = await Promise.all([
        sources.recentRuns(100),
        sources.summary(),
      ]);
      setScanLogs(runsRes.data || []);
      setScanSummary(summaryRes.data || null);
    } catch {
      // not critical
    }
  }, []);

  async function handleRefreshSources() {
    setRefreshing(true);
    setScanBanner('');
    try {
      const res = await sources.runAll();
      const count = res.data?.queued ?? '?';
      setScanBanner(`Scan queued for ${count} active source${count !== 1 ? 's' : ''}. New opportunities will appear in a few minutes.`);
      setShowScanLogs(true);
      await loadScanStatus();
      const interval = setInterval(loadScanStatus, 8000);
      setTimeout(() => {
        clearInterval(interval);
        setScanBanner('');
      }, 90000);
    } catch (err: unknown) {
      const httpStatus = (err as { response?: { status?: number } })?.response?.status;
      setScanBanner(httpStatus === 403
        ? 'Admin access required to trigger source scans.'
        : 'Failed to trigger scan. Check that the backend is running.');
      setTimeout(() => setScanBanner(''), 5000);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRunSource(sourceId: string) {
    setRunningSources(prev => ({ ...prev, [sourceId]: true }));
    setSourceRunResults(prev => { const n = { ...prev }; delete n[sourceId]; return n; });
    try {
      await sources.runNow(sourceId);
      setSourceRunResults(prev => ({ ...prev, [sourceId]: 'queued' }));
      setShowScanLogs(true);
      await loadScanStatus();
      setTimeout(() => {
        setSourceRunResults(prev => { const n = { ...prev }; delete n[sourceId]; return n; });
      }, 8000);
    } catch {
      setSourceRunResults(prev => ({ ...prev, [sourceId]: 'error' }));
      setTimeout(() => {
        setSourceRunResults(prev => { const n = { ...prev }; delete n[sourceId]; return n; });
      }, 5000);
    } finally {
      setRunningSources(prev => ({ ...prev, [sourceId]: false }));
    }
  }

  async function handleCustomRank() {
    setRanking(true);
    setScanBanner('');
    try {
      await organizations.triggerLlmRank(institutionId);
      setScanBanner('Custom AI ranking queued. Scores will update within a few minutes.');
      setTimeout(() => setScanBanner(''), 8000);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { detail?: string } } })?.response?.data;
      setScanBanner(data?.detail ?? 'Failed to queue custom ranking.');
      setTimeout(() => setScanBanner(''), 6000);
    } finally {
      setRanking(false);
    }
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

      <section className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Organization filters</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {isOrgAdmin
              ? 'Applies to all members. Used to score and surface grants for your team.'
              : 'Set by your organization admin. Used to score and surface grants for your team.'}
          </p>
        </div>

        {isOrgAdmin ? (
          <>
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
            <PriorityFunderGroupsEditor
              groups={orgProfile.priority_funders ?? []}
              onChange={priority_funders => setOrgProfile(p => ({ ...p, priority_funders }))}
            />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Team / project context</label>
              <textarea
                value={orgProfile.projects ?? ''}
                onChange={e => setOrgProfile(p => ({ ...p, projects: e.target.value }))}
                rows={3}
                placeholder="Describe active projects and research areas for AI summaries"
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
          </>
        ) : (
          <>
            <ReadOnlyTagList
              label="Keywords & themes"
              tags={orgProfile.keywords ?? []}
              emptyText="No org keywords set"
            />
            <ReadOnlyTagList
              label="Geographies"
              tags={orgProfile.geographies ?? []}
              emptyText="No geographies set"
            />
            <ReadOnlyTagList
              label="Excluded keywords"
              tags={orgProfile.excluded_keywords ?? []}
              emptyText="None"
            />
            {(orgProfile.priority_funders ?? []).length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Priority funder groups</label>
                <div className="space-y-1.5">
                  {(orgProfile.priority_funders ?? []).map(group => (
                    <p key={group.name} className="text-xs text-gray-600">
                      <span className="font-medium">{group.name}:</span> {group.funders.join(', ') || 'none'}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {orgProfile.projects && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team / project context</label>
                <p className="text-sm text-gray-600 bg-gray-50 rounded-md px-3 py-2">{orgProfile.projects}</p>
              </div>
            )}
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-6V7m0 0a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
              To update these filters, contact your organization admin.
            </p>
          </>
        )}
      </section>

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
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                {s.category && <p className="text-xs text-gray-400">{s.category}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isOrgAdmin && (
                  <button
                    onClick={() => handleRunSource(s.id)}
                    disabled={runningSources[s.id]}
                    title="Run scan for this source"
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      sourceRunResults[s.id] === 'queued'
                        ? 'border-blue-200 text-blue-700 bg-blue-50'
                        : sourceRunResults[s.id] === 'error'
                        ? 'border-red-200 text-red-600 bg-red-50'
                        : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50'
                    }`}
                  >
                    {runningSources[s.id] ? (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Running…
                      </span>
                    ) : sourceRunResults[s.id] === 'queued' ? (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Queued
                      </span>
                    ) : sourceRunResults[s.id] === 'error' ? (
                      'Failed'
                    ) : (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Run
                      </span>
                    )}
                  </button>
                )}
                {isOrgAdmin ? (
                  <button
                    onClick={() => toggleSource(s.id, s.is_enabled)}
                    className={`text-xs px-2.5 py-1 rounded-md border ${
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
            </div>
          ))}
        </div>
      </section>

      {isOrgAdmin && (
        <section className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Data management</h3>
            <p className="text-xs text-gray-400 mt-0.5">Admin-only actions for refreshing grant data and scoring.</p>
          </div>

          {scanBanner && (
            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              {scanBanner}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 mb-1">Refresh Sources</p>
              <p className="text-xs text-gray-400 mb-3">Re-scan all active grant sources and pull in new opportunities.</p>
              <button
                onClick={handleRefreshSources}
                disabled={refreshing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <svg className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {refreshing ? 'Scanning…' : 'Refresh Sources'}
              </button>
            </div>

            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 mb-1">Custom Rank</p>
              <p className="text-xs text-gray-400 mb-3">
                Use AI to score all opportunities against your org profile and keywords — more precise than keyword matching alone. Results shown as High / Medium / Low fit.
              </p>
              <button
                onClick={handleCustomRank}
                disabled={ranking}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                <svg className={`w-3 h-3 ${ranking ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a2 2 0 01-1.414.586H9.88a2 2 0 01-1.414-.586l-.347-.347z" />
                </svg>
                {ranking ? 'Queuing…' : 'Custom Rank'}
              </button>
            </div>

            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 mb-1">Run Discovery</p>
              <p className="text-xs text-gray-400 mb-3">
                Use Exa.ai neural search to find new funding portals not yet in the database. High-confidence finds are added automatically; others go to review.
              </p>
              <button
                onClick={async () => {
                  setDiscovering(true);
                  try {
                    await admin.discoverSources();
                    setScanBanner('Discovery task queued — new portals will appear in Data Sources within a few minutes.');
                    setTimeout(() => setScanBanner(''), 10000);
                  } catch {
                    setScanBanner('Failed to queue discovery task. Admin access required.');
                    setTimeout(() => setScanBanner(''), 5000);
                  } finally {
                    setDiscovering(false);
                  }
                }}
                disabled={discovering}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <svg className={`w-3 h-3 ${discovering ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                {discovering ? 'Queuing…' : 'Run Discovery'}
              </button>
            </div>

            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 mb-1">Backfill Types</p>
              <p className="text-xs text-gray-400 mb-3">
                Use AI to classify the opportunity type (grant, fellowship, residency, prize, etc.) for all existing opportunities that are missing a type label.
              </p>
              <button
                onClick={async () => {
                  setBackfilling(true);
                  try {
                    await admin.backfillOpportunityTypes();
                    setScanBanner('Type backfill queued — opportunity type badges will populate within a few minutes.');
                    setTimeout(() => setScanBanner(''), 10000);
                  } catch {
                    setScanBanner('Failed to queue backfill task. Admin access required.');
                    setTimeout(() => setScanBanner(''), 5000);
                  } finally {
                    setBackfilling(false);
                  }
                }}
                disabled={backfilling}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-500 text-white rounded-md hover:bg-violet-600 disabled:opacity-50 transition-colors"
              >
                <svg className={`w-3 h-3 ${backfilling ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                </svg>
                {backfilling ? 'Queuing…' : 'Backfill Types'}
              </button>
            </div>
          </div>

          {/* Scan log toggle */}
          <div>
            <button
              onClick={async () => {
                const next = !showScanLogs;
                setShowScanLogs(next);
                if (next) await loadScanStatus();
              }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform ${showScanLogs ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              {showScanLogs ? 'Hide scan log' : 'Show scan log'}
            </button>

            {showScanLogs && (
              <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden bg-white">
                {scanSummary && (
                  <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                      {scanSummary.sources_by_status?.active ?? 0} active
                    </span>
                    {(scanSummary.running_scans ?? 0) > 0 && (
                      <span className="text-blue-600">{scanSummary.running_scans} running</span>
                    )}
                    {(scanSummary.recent_errors_24h ?? 0) > 0 && (
                      <span className="text-red-500">{scanSummary.recent_errors_24h} errors (24h)</span>
                    )}
                    <span>{scanSummary.total_opportunities?.toLocaleString()} opps in DB</span>
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto">
                  {scanLogs.length === 0 ? (
                    <p className="px-4 py-5 text-center text-xs text-gray-400">No scan runs yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wider">
                          <th className="text-left px-4 py-2">Source</th>
                          <th className="text-left px-4 py-2">Status</th>
                          <th className="text-right px-4 py-2">Found</th>
                          <th className="text-right px-4 py-2">New</th>
                          <th className="text-left px-4 py-2">Started</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanLogs.map(run => (
                          <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-700 max-w-[160px] truncate">{run.source_name}</td>
                            <td className="px-4 py-2">
                              <span className={`${run.status === 'success' ? 'text-green-600' : run.status === 'failed' ? 'text-red-500' : run.status === 'running' ? 'text-blue-600' : 'text-gray-400'}`}>
                                {run.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right text-gray-500">{run.records_found ?? '—'}</td>
                            <td className="px-4 py-2 text-right text-gray-700 font-medium">{run.new_opportunities ?? '—'}</td>
                            <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                              {run.started_at ? new Date(run.started_at).toLocaleTimeString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
