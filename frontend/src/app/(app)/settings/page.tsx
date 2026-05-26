'use client';
import { useEffect, useState } from 'react';
import { sources, auth } from '@/lib/api';
import { MembersPanel } from '@/components/settings/MembersPanel';
import { JoinRequestsPanel } from '@/components/settings/JoinRequestsPanel';
import { InvitePanel } from '@/components/settings/InvitePanel';
import { ProfilePanel } from '@/components/settings/ProfilePanel';
import { GrantFiltersPanel } from '@/components/settings/GrantFiltersPanel';

interface Source {
  id: string;
  name: string;
  category?: string;
  url?: string;
  api_endpoint?: string;
  source_type: string;
  status?: string;
  is_high_priority?: boolean;
  auth_required?: boolean;
  refresh_frequency?: string;
  logo_url?: string;
  notes?: string;
  relevant_themes?: string[];
  relevant_geographies?: string[];
  last_checked?: string;
  last_successful_run?: string;
  opportunities_discovered?: number;
  opportunities_added?: number;
  scraper_config?: Record<string, unknown>;
}

const SOURCE_TYPES = [
  { value: 'ai_scraper',  label: 'AI-powered scraper',        hint: 'Works on most sites — no CSS selectors needed' },
  { value: 'rss',         label: 'RSS feed',                  hint: 'Standard RSS/Atom feed URL' },
  { value: 'api',         label: 'REST API',                  hint: 'Structured JSON API endpoint' },
  { value: 'html_static', label: 'Static website (HTML)',     hint: 'Provide optional CSS selectors for precision' },
  { value: 'manual',      label: 'Manual',                    hint: 'No automated fetching' },
];

const FREQUENCIES = ['daily', 'weekly', 'monthly'];

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return d; }
}

function StatusBadge({ status }: { status?: string }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium';
  if (status === 'active')   return <span className={`${base} bg-green-100 text-green-700`}>Active</span>;
  if (status === 'paused')   return <span className={`${base} bg-yellow-100 text-yellow-700`}>Paused</span>;
  if (status === 'broken')   return <span className={`${base} bg-red-100 text-red-700`}>Broken</span>;
  return <span className={`${base} bg-gray-100 text-gray-600`}>{status ?? '—'}</span>;
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    ai_scraper:  'AI scraper',
    rss:         'RSS',
    api:         'API',
    html_static: 'HTML',
    html_dynamic:'HTML (JS)',
    manual:      'Manual',
    scraper:     'AI scraper',
  };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
      {labels[type] ?? type}
    </span>
  );
}

interface ScraperConfigPanelProps {
  sourceType: string;
  config: Record<string, string | number | boolean>;
  onChange: (cfg: Record<string, string | number | boolean>) => void;
}

function ScraperConfigPanel({ sourceType, config, onChange }: ScraperConfigPanelProps) {
  const update = (key: string, value: string | number | boolean) =>
    onChange({ ...config, [key]: value });

  if (sourceType === 'ai_scraper') {
    return (
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">AI scraper options</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Crawl depth
              <span className="ml-1 font-normal text-gray-400">(0 = listing page only, 1 = follow links)</span>
            </label>
            <select
              value={String(config.crawl_depth ?? 0)}
              onChange={e => update('crawl_depth', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="0">0 — listing page only</option>
              <option value="1">1 — follow detail links</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Link filter pattern
              <span className="ml-1 font-normal text-gray-400">(regex, optional)</span>
            </label>
            <input
              value={String(config.link_filter ?? '')}
              onChange={e => update('link_filter', e.target.value)}
              placeholder="e.g. /grants/|/funding/"
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="use_playwright"
            checked={config.use_playwright !== false}
            onChange={e => update('use_playwright', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="use_playwright" className="text-xs text-gray-600">
            Use Playwright for JS-rendered pages
            <span className="ml-1 text-gray-400">(uncheck for simple static sites)</span>
          </label>
        </div>
      </div>
    );
  }

  if (sourceType === 'html_static' || sourceType === 'html_dynamic') {
    return (
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">CSS selector config <span className="font-normal normal-case text-gray-400">(all optional)</span></p>
        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'item_selector',  label: 'Grant item selector',  placeholder: '.grant-item, .listing-row' },
            { key: 'title_selector', label: 'Title selector',        placeholder: 'h2, h3, .grant-title' },
            { key: 'link_selector',  label: 'Link selector',         placeholder: 'a.grant-link' },
            { key: 'desc_selector',  label: 'Description selector',  placeholder: '.summary, p' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input
                value={String(config[key] ?? '')}
                onChange={e => update(key, e.target.value)}
                placeholder={placeholder}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

type Tab = 'sources' | 'organization' | 'profile';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sources');
  const [currentUser, setCurrentUser] = useState<{ role?: string; institution_id?: string; institution_role?: string } | null>(null);

  useEffect(() => {
    auth.me().then(r => setCurrentUser(r.data)).catch(() => {});
  }, []);

  const isPlatformAdmin = currentUser?.role === 'admin';
  const isOrgAdmin = currentUser?.institution_role === 'admin';
  const isAdmin = isPlatformAdmin || isOrgAdmin;
  const hasInstitution = Boolean(currentUser?.institution_id);

  const [sourceList, setSourceList] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [scanningAll, setScanningAll] = useState(false);
  const [scanAllResult, setScanAllResult] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);

  // New source form state
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newApiEndpoint, setNewApiEndpoint] = useState('');
  const [newLogoUrl, setNewLogoUrl] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newThemes, setNewThemes] = useState('');
  const [newType, setNewType] = useState('ai_scraper');
  const [newFrequency, setNewFrequency] = useState('weekly');
  const [newHighPriority, setNewHighPriority] = useState(false);
  const [newAuthRequired, setNewAuthRequired] = useState(false);
  const [newScraperConfig, setNewScraperConfig] = useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  function fetchSources() {
    sources.list()
      .then(r => setSourceList(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchSources(); }, []);

  function resetForm() {
    setNewName('');
    setNewUrl('');
    setNewApiEndpoint('');
    setNewLogoUrl('');
    setNewCategory('');
    setNewNotes('');
    setNewThemes('');
    setNewType('ai_scraper');
    setNewFrequency('weekly');
    setNewHighPriority(false);
    setNewAuthRequired(false);
    setNewScraperConfig({});
    setShowAdd(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const themeList = newThemes.split(',').map(t => t.trim()).filter(Boolean);
      await sources.create({
        name: newName,
        url: newUrl || undefined,
        api_endpoint: newApiEndpoint || undefined,
        logo_url: newLogoUrl || undefined,
        category: newCategory || undefined,
        notes: newNotes || undefined,
        relevant_themes: themeList,
        source_type: newType,
        refresh_frequency: newFrequency,
        is_high_priority: newHighPriority,
        auth_required: newAuthRequired,
        scraper_config: newScraperConfig,
      });
      resetForm();
      fetchSources();
    } finally {
      setSaving(false);
    }
  }

  async function handleScanAll() {
    setScanningAll(true);
    setScanAllResult(null);
    try {
      const res = await sources.runAll();
      setScanAllResult(res.data?.message ?? 'Scan queued.');
      setTimeout(() => setScanAllResult(null), 6000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setScanAllResult('Admin access required to trigger scans.');
      } else {
        setScanAllResult('Failed to trigger scan. Is the worker running?');
      }
      setTimeout(() => setScanAllResult(null), 6000);
    } finally {
      setScanningAll(false);
    }
  }

  async function handleRunNow(id: string) {
    setRunning(id);
    try {
      await sources.runNow(id);
      fetchSources();
    } finally {
      setRunning(null);
    }
  }

  async function handleToggle(id: string) {
    setToggling(id);
    try {
      await sources.toggle(id);
      fetchSources();
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete source "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await sources.delete(id);
      fetchSources();
    } finally {
      setDeleting(null);
    }
  }

  const selectedTypeInfo = SOURCE_TYPES.find(t => t.value === newType);

  const tabs: { id: Tab; label: string; show?: boolean }[] = [
    { id: 'sources', label: 'Data Sources', show: hasInstitution },
    { id: 'organization', label: 'Organization', show: isAdmin && hasInstitution },
    { id: 'profile', label: 'My Profile', show: true },
  ];

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and organization</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="-mb-px flex gap-6">
          {tabs
            .filter(t => t.show !== false)
            .map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
        </nav>
      </div>

      {/* Profile tab */}
      {activeTab === 'profile' && <ProfilePanel />}

      {/* Organization tab */}
      {activeTab === 'organization' && currentUser?.institution_id && (
        <div className="space-y-10">
          <MembersPanel institutionId={currentUser.institution_id} />
          <JoinRequestsPanel institutionId={currentUser.institution_id} />
          <InvitePanel institutionId={currentUser.institution_id} />
        </div>
      )}

      {/* Data Sources tab */}
      {activeTab === 'sources' && currentUser?.institution_id && (
      <div>
      {currentUser.institution_id && (
        <GrantFiltersPanel institutionId={currentUser.institution_id} isOrgAdmin={isOrgAdmin} />
      )}

      {isPlatformAdmin && (
      <>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Data Sources</h2>
          <p className="text-sm text-gray-500 mt-1">Manage grant discovery sources</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={handleScanAll}
            disabled={scanningAll || sourceList.length === 0}
            className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scanningAll ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Scanning…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z" />
                </svg>
                Scan all sources now
              </>
            )}
          </button>
          {scanAllResult && (
            <p className="text-xs text-gray-500">{scanAllResult}</p>
          )}
        </div>
      </div>

      {/* Data Sources section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Data Sources</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Add websites, RSS feeds, or APIs to automatically discover new grant opportunities.
            </p>
          </div>
          <button
            onClick={() => { setShowAdd(!showAdd); }}
            className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-50"
          >
            {showAdd ? 'Cancel' : '+ Add source'}
          </button>
        </div>

        {/* Add source form */}
        {showAdd && (
          <form onSubmit={handleAdd} className="mb-5 border border-gray-200 rounded-lg p-5 bg-white space-y-4">
            <h3 className="text-sm font-semibold text-gray-800">New source</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Wellcome Trust Grants"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Source type</label>
                <select
                  value={newType}
                  onChange={e => { setNewType(e.target.value); setNewScraperConfig({}); }}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {SOURCE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {selectedTypeInfo && (
                  <p className="text-xs text-gray-400 mt-1">{selectedTypeInfo.hint}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
                <input
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">API endpoint</label>
                <input
                  value={newApiEndpoint}
                  onChange={e => setNewApiEndpoint(e.target.value)}
                  placeholder="https://api.example.com/grants"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <input
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="e.g. health, climate"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Relevant themes <span className="font-normal text-gray-400">(comma-separated)</span></label>
                <input
                  value={newThemes}
                  onChange={e => setNewThemes(e.target.value)}
                  placeholder="e.g. AI, global health, diagnostics"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Logo URL <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  value={newLogoUrl}
                  onChange={e => setNewLogoUrl(e.target.value)}
                  placeholder="https://…/logo.svg"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Scan frequency</label>
                <select
                  value={newFrequency}
                  onChange={e => setNewFrequency(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {FREQUENCIES.map(f => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes <span className="font-normal text-gray-400">(optional)</span></label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Rate limits, auth requirements, scraping notes…"
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex items-center gap-4 col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="high_priority"
                    checked={newHighPriority}
                    onChange={e => setNewHighPriority(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="high_priority" className="text-xs text-gray-600">
                    High priority <span className="text-gray-400">(daily scans)</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="auth_required"
                    checked={newAuthRequired}
                    onChange={e => setNewAuthRequired(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="auth_required" className="text-xs text-gray-600">
                    Auth required
                  </label>
                </div>
              </div>
            </div>

            {/* Scraper config panel */}
            {(newType === 'ai_scraper' || newType === 'html_static' || newType === 'html_dynamic') && (
              <ScraperConfigPanel
                sourceType={newType}
                config={newScraperConfig}
                onChange={setNewScraperConfig}
              />
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="text-sm px-3 py-1.5 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add source'}
              </button>
            </div>
          </form>
        )}

        {/* Source list table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Type / Endpoints</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Last run</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : sourceList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <p className="text-gray-400 mb-1">No sources configured.</p>
                    <p className="text-xs text-gray-300">Add a source above to start automated grant discovery.</p>
                  </td>
                </tr>
              ) : (
                sourceList.map(s => (
                  <>
                  <tr
                    key={s.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedSource(expandedSource === s.id ? null : s.id)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        {s.logo_url ? (
                          <img src={s.logo_url} alt={s.name} className="w-5 h-5 rounded object-contain flex-shrink-0" onError={e => (e.currentTarget.style.display = 'none')} />
                        ) : (
                          <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-400 text-xs">{s.name.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 flex items-center gap-1.5 flex-wrap">
                            {s.name}
                            {s.is_high_priority && (
                              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Priority</span>
                            )}
                            {s.auth_required && (
                              <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">Auth</span>
                            )}
                          </div>
                          {s.category && <div className="text-xs text-gray-400 mt-0.5">{s.category}</div>}
                          {(s.relevant_themes ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {s.relevant_themes!.slice(0, 5).map(t => (
                                <span key={t} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{t}</span>
                              ))}
                              {(s.relevant_themes!.length > 5) && (
                                <span className="text-xs text-gray-400">+{s.relevant_themes!.length - 5}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <div className="space-y-1.5">
                        <TypeBadge type={s.source_type} />
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="block text-xs text-blue-600 hover:underline truncate max-w-[200px]"
                          >
                            {s.url}
                          </a>
                        )}
                        {s.api_endpoint && (
                          <a
                            href={s.api_endpoint}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="block text-xs text-purple-600 hover:underline truncate max-w-[200px]"
                          >
                            API: {s.api_endpoint}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell text-xs text-gray-500">
                      <div>{formatDate(s.last_successful_run) ?? formatDate(s.last_checked) ?? 'Never'}</div>
                      {s.opportunities_discovered != null && s.opportunities_discovered > 0 && (
                        <div className="text-gray-400 mt-0.5">{s.opportunities_discovered} found · {s.opportunities_added ?? 0} added</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleRunNow(s.id)}
                          disabled={running === s.id || s.status === 'paused'}
                          title="Run now"
                          className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {running === s.id ? 'Running…' : 'Run now'}
                        </button>
                        <button
                          onClick={() => handleToggle(s.id)}
                          disabled={toggling === s.id}
                          title={s.status === 'active' ? 'Pause' : 'Resume'}
                          className="text-xs text-gray-600 hover:text-gray-800 border border-gray-200 px-2.5 py-1 rounded-md hover:bg-gray-50 disabled:opacity-40"
                        >
                          {toggling === s.id ? '…' : s.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => handleDelete(s.id, s.name)}
                          disabled={deleting === s.id}
                          title="Delete source"
                          className="text-xs text-red-500 hover:text-red-700 border border-red-100 px-2.5 py-1 rounded-md hover:bg-red-50 disabled:opacity-40"
                        >
                          {deleting === s.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedSource === s.id && (
                    <tr key={`${s.id}-expanded`} className="bg-gray-50">
                      <td colSpan={5} className="px-5 py-4 border-t border-gray-100">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                          {s.url && (
                            <div>
                              <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">URL</p>
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{s.url}</a>
                            </div>
                          )}
                          {s.api_endpoint && (
                            <div>
                              <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">API Endpoint</p>
                              <a href={s.api_endpoint} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline break-all">{s.api_endpoint}</a>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Scraper Type</p>
                            <TypeBadge type={s.source_type} />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Frequency</p>
                            <span className="text-gray-700 capitalize">{s.refresh_frequency ?? 'weekly'}</span>
                          </div>
                          {(s.relevant_themes ?? []).length > 0 && (
                            <div className="col-span-2">
                              <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Themes</p>
                              <div className="flex flex-wrap gap-1">
                                {s.relevant_themes!.map(t => (
                                  <span key={t} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{t}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {s.notes && (
                            <div className="col-span-3">
                              <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                              <p className="text-gray-600 leading-relaxed">{s.notes}</p>
                            </div>
                          )}
                          {s.scraper_config && Object.keys(s.scraper_config).length > 0 && (
                            <div className="col-span-3">
                              <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Scraper Config</p>
                              <pre className="bg-white border border-gray-200 rounded p-2 overflow-x-auto text-gray-700 font-mono">{JSON.stringify(s.scraper_config, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Scraper type legend */}
        <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs font-semibold text-blue-700 mb-2">About source types</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {SOURCE_TYPES.map(t => (
              <div key={t.value} className="flex gap-2 text-xs text-blue-600">
                <span className="font-medium w-32 shrink-0">{t.label}</span>
                <span className="text-blue-500">{t.hint}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
      )}
      </div>
      )}
    </div>
  );
}
