'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { sources, auth, admin } from '@/lib/api';
import { notifyOpportunitiesChanged } from '@/lib/opportunities-events';
import { MembersPanel } from '@/components/settings/MembersPanel';
import { JoinRequestsPanel } from '@/components/settings/JoinRequestsPanel';
import { InvitePanel } from '@/components/settings/InvitePanel';
import { ProfilePanel } from '@/components/settings/ProfilePanel';
import { GrantFiltersPanel } from '@/components/settings/GrantFiltersPanel';
import { useAuth } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

function GoogleIntegrationCard() {
  const { user, refresh } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const isConnected = Boolean(user?.google_access_token);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await auth.googleStart();
      if (res.data?.authorization_url) {
        window.location.href = res.data.authorization_url;
      }
    } catch {
      alert('Google OAuth not configured. Please contact your administrator.');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect your Google account?')) return;
    setDisconnecting(true);
    try {
      await auth.googleDisconnect();
      await refresh();
    } catch {
      alert('Failed to disconnect Google account.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div
      className="px-5 py-4 flex items-start justify-between gap-4"
      style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 flex items-center justify-center shrink-0 mt-0.5"
          style={{
            border: '1px solid var(--rule-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-raised)',
          }}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Google Docs</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            Connect to create and link Google Docs for proposal writing.
          </p>
          {isConnected && (
            <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--state-success)' }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--state-success)' }} />
              Connected
            </p>
          )}
        </div>
      </div>
      {isConnected ? (
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-50 shrink-0"
          style={{
            color: 'var(--accent-primary)',
            border: '1px solid var(--accent-primary)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-50 shrink-0"
          style={{
            color: 'var(--accent-primary)',
            border: '1px solid var(--accent-primary)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {connecting ? 'Connecting…' : 'Connect Google'}
        </button>
      )}
    </div>
  );
}

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
  const getStyle = (s?: string): React.CSSProperties => {
    if (s === 'active')       return { background: 'var(--state-success-bg)', color: 'var(--state-success)' };
    if (s === 'paused')       return { background: 'var(--state-warning-bg)', color: 'var(--state-warning)' };
    if (s === 'broken')       return { background: 'var(--state-danger-bg)',  color: 'var(--state-danger)' };
    if (s === 'under_review') return { background: 'var(--state-warning-bg)', color: 'var(--state-warning)' };
    return { background: 'var(--surface-sunken)', color: 'var(--ink-muted)' };
  };
  const labels: Record<string, string> = { active: 'Active', paused: 'Paused', broken: 'Broken', under_review: 'Under Review' };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-[var(--radius-xs)]"
      style={getStyle(status)}
    >
      {labels[status ?? ''] ?? status ?? '—'}
    </span>
  );
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
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-[var(--radius-xs)]"
      style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
    >
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

  const scrapInputStyle: React.CSSProperties = {
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-xs)',
    background: 'var(--surface-panel)',
    color: 'var(--ink-primary)',
    outline: 'none',
    fontSize: '0.875rem',
    width: '100%',
    padding: '6px 10px',
  };

  if (sourceType === 'ai_scraper') {
    return (
      <div
        className="p-4 space-y-3"
        style={{
          border: '1px solid var(--rule-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-sunken)',
        }}
      >
        <p className="ledger-label">AI scraper options</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
              Crawl depth
              <span className="ml-1 font-normal" style={{ color: 'var(--ink-faint)' }}>(0 = listing page only, 1 = follow links)</span>
            </label>
            <select
              value={String(config.crawl_depth ?? 0)}
              onChange={e => update('crawl_depth', Number(e.target.value))}
              style={scrapInputStyle}
            >
              <option value="0">0 — listing page only</option>
              <option value="1">1 — follow detail links</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
              Link filter pattern
              <span className="ml-1 font-normal" style={{ color: 'var(--ink-faint)' }}>(regex, optional)</span>
            </label>
            <input
              value={String(config.link_filter ?? '')}
              onChange={e => update('link_filter', e.target.value)}
              placeholder="e.g. /grants/|/funding/"
              style={scrapInputStyle}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="use_playwright"
            checked={config.use_playwright !== false}
            onChange={e => update('use_playwright', e.target.checked)}
            className="rounded"
          />
          <label htmlFor="use_playwright" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            Use Playwright for JS-rendered pages
            <span className="ml-1" style={{ color: 'var(--ink-faint)' }}>(uncheck for simple static sites)</span>
          </label>
        </div>
      </div>
    );
  }

  if (sourceType === 'html_static' || sourceType === 'html_dynamic') {
    return (
      <div
        className="p-4 space-y-3"
        style={{
          border: '1px solid var(--rule-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-sunken)',
        }}
      >
        <p className="ledger-label">
          CSS selector config <span className="font-normal normal-case" style={{ color: 'var(--ink-faint)' }}>(all optional)</span>
        </p>
        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'item_selector',  label: 'Grant item selector',  placeholder: '.grant-item, .listing-row' },
            { key: 'title_selector', label: 'Title selector',        placeholder: 'h2, h3, .grant-title' },
            { key: 'link_selector',  label: 'Link selector',         placeholder: 'a.grant-link' },
            { key: 'desc_selector',  label: 'Description selector',  placeholder: '.summary, p' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>{label}</label>
              <input
                value={String(config[key] ?? '')}
                onChange={e => update(key, e.target.value)}
                placeholder={placeholder}
                style={{ ...scrapInputStyle, fontFamily: 'var(--font-mono, monospace)' }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

type Tab = 'sources' | 'organization' | 'profile' | 'integrations' | 'usage';

function UsageTab({ user }: { user: AuthUser | null }) {
  if (!user) return <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</p>;

  const used = user.ai_usage_cents;
  const limit = user.ai_usage_limit_cents;
  const hasLimit = limit > 0;
  const pct = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const usedDollars = (used / 100).toFixed(2);
  const limitDollars = hasLimit ? (limit / 100).toFixed(2) : null;

  const barColor = pct >= 100 ? 'var(--state-danger)' : pct >= 80 ? 'var(--state-warning)' : 'var(--accent-primary)';
  const statusColor = pct >= 100 ? 'var(--state-danger)' : pct >= 80 ? 'var(--state-warning)' : 'var(--state-success)';
  const statusLabel = pct >= 100 ? 'Limit reached' : pct >= 80 ? 'Approaching limit' : 'Within limit';

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--ink-primary)' }}>Usage</h2>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Monitor your AI usage and current limits for this billing period.</p>
      </div>

      {/* AI Usage card */}
      <div style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--rule-subtle)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 flex items-center justify-center"
              style={{ background: 'var(--state-info-bg)', borderRadius: 'var(--radius-sm)' }}
            >
              <svg className="w-4 h-4" style={{ color: 'var(--state-info)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>AI Usage</p>
              <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>Current billing period</p>
            </div>
          </div>
          {hasLimit && (
            <span className="text-xs font-medium" style={{ color: statusColor }}>{statusLabel}</span>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <span className="mono-data text-3xl font-semibold" style={{ color: 'var(--ink-primary)' }}>${usedDollars}</span>
              {limitDollars && (
                <span className="mono-data text-lg ml-1" style={{ color: 'var(--ink-faint)' }}>/ ${limitDollars}</span>
              )}
            </div>
            {hasLimit && (
              <span className="mono-data text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>{pct}% used</span>
            )}
          </div>

          {hasLimit && (
            <div>
              <div
                className="w-full h-1.5 overflow-hidden"
                style={{ background: 'var(--rule-subtle)', borderRadius: 'var(--radius-xs)' }}
              >
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: barColor, borderRadius: 'var(--radius-xs)' }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="mono-data text-[10px]" style={{ color: 'var(--ink-faint)' }}>$0.00</span>
                <span className="mono-data text-[10px]" style={{ color: 'var(--ink-faint)' }}>${limitDollars}</span>
              </div>
            </div>
          )}

          {!hasLimit && (
            <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>No usage limit is set for your account.</p>
          )}
        </div>

        {pct >= 100 && (
          <div
            className="px-5 py-3 flex items-start gap-2.5"
            style={{ background: 'var(--state-danger-bg)', borderTop: '1px solid var(--state-danger)' }}
          >
            <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--state-danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--state-danger)' }}>AI features are temporarily unavailable</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--state-danger)', opacity: 0.8 }}>You have reached your usage limit. Contact support to increase your limit.</p>
            </div>
          </div>
        )}

        {pct >= 80 && pct < 100 && (
          <div
            className="px-5 py-3 flex items-center gap-2.5"
            style={{ background: 'var(--state-warning-bg)', borderTop: '1px solid var(--state-warning)' }}
          >
            <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--state-warning)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs" style={{ color: 'var(--state-warning)' }}>You are approaching your usage limit. Contact support if you need more capacity.</p>
          </div>
        )}
      </div>

      {/* Limits info */}
      {hasLimit && (
        <div
          className="px-5 py-4 space-y-3"
          style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Limits</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--ink-muted)' }}>AI usage limit</span>
              <span className="mono-data font-medium" style={{ color: 'var(--ink-primary)' }}>${limitDollars} / period</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--ink-muted)' }}>Remaining</span>
              <span
                className="mono-data font-medium"
                style={{ color: pct >= 100 ? 'var(--state-danger)' : 'var(--ink-primary)' }}
              >
                ${Math.max(0, (limit - used) / 100).toFixed(2)}
              </span>
            </div>
          </div>
          <p
            className="text-xs pt-1"
            style={{ color: 'var(--ink-faint)', borderTop: '1px solid var(--rule-subtle)' }}
          >
            To request a limit increase, contact your administrator or support.
          </p>
        </div>
      )}
    </div>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const { refresh, user: authUser } = useAuth();
  const googleConnected = searchParams.get('google_connected');
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    // Honor explicit ?tab= param; otherwise default based on role (set after load)
    return (searchParams.get('tab') as Tab) ?? 'profile';
  });
  const [currentUser, setCurrentUser] = useState<{ role?: string; institution_id?: string; institution_role?: string } | null>(null);
  const [googleSuccess, setGoogleSuccess] = useState(Boolean(googleConnected));

  useEffect(() => {
    auth.me().then(r => {
      setCurrentUser(r.data);
      // If no explicit tab was specified in the URL, land on the best default
      if (!searchParams.get('tab')) {
        const isAdminUser = r.data?.role === 'admin' || r.data?.institution_role === 'admin';
        const hasInst = Boolean(r.data?.institution_id);
        setActiveTab(isAdminUser && hasInst ? 'sources' : 'profile');
      }
    }).catch(() => {});
    if (googleConnected) {
      refresh().catch(() => {});
      const t = setTimeout(() => setGoogleSuccess(false), 5000);
      return () => clearTimeout(t);
    }
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
  const [deduplicating, setDeduplicating] = useState(false);
  const [dedupResult, setDedupResult] = useState<string | null>(null);
  const [discoveringSource, setDiscoveringSource] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<string | null>(null);
  const [backfillingTypes, setBackfillingTypes] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
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
  const [expandedTab, setExpandedTab] = useState<Record<string, 'edit' | 'runs'>>({});

  // Run history state
  interface SourceRunRecord {
    id: string;
    started_at: string | null;
    ended_at: string | null;
    status: string;
    records_found: number;
    new_opportunities: number;
    updated_opportunities: number;
    duplicates: number;
    errors: string[];
    warnings: string[];
    log_summary: string | null;
    traceback: string | null;
  }
  const [sourceRuns, setSourceRuns] = useState<Record<string, SourceRunRecord[]>>({});
  const [loadingRuns, setLoadingRuns] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState<string | null>(null);
  const [diagnoses, setDiagnoses] = useState<Record<string, {
    diagnosis: string;
    root_cause: string | null;
    suggested_config: Record<string, unknown> | null;
    suggested_type: string | null;
    action_items: string[];
  }>>({});

  async function fetchRunHistory(sourceId: string) {
    setLoadingRuns(sourceId);
    try {
      const res = await sources.getRuns(sourceId);
      setSourceRuns(prev => ({ ...prev, [sourceId]: res.data }));
    } catch {
      // silently fail — shows empty state
    } finally {
      setLoadingRuns(null);
    }
  }

  async function handleDiagnose(sourceId: string, runId: string) {
    setDiagnosing(runId);
    try {
      const res = await sources.diagnoseRun(sourceId, runId);
      setDiagnoses(prev => ({ ...prev, [runId]: res.data }));
    } catch {
      setDiagnoses(prev => ({ ...prev, [runId]: {
        diagnosis: 'Diagnosis failed — check that the AI service is configured.',
        root_cause: null,
        suggested_config: null,
        suggested_type: null,
        action_items: [],
      }}));
    } finally {
      setDiagnosing(null);
    }
  }

  function applyDiagnosisFix(sourceId: string, runId: string) {
    const diag = diagnoses[runId];
    if (!diag?.suggested_config) return;
    setDetailDraft(prev => ({
      ...prev,
      [sourceId]: {
        ...prev[sourceId],
        _scraperConfigText: JSON.stringify(diag.suggested_config, null, 2),
      },
    }));
    setExpandedTab(prev => ({ ...prev, [sourceId]: 'edit' }));
  }

  // Source review / inline edit state
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'under_review' | 'paused' | 'broken'>('all');
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<Record<string, { name: string; url: string; notes: string; refresh_frequency: string; relevant_themes: string[]; relevant_geographies: string[]; _scraperConfigText: string }>>({});
  const [savingDetail, setSavingDetail] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});

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

  async function handleDedup() {
    setDeduplicating(true);
    setDedupResult(null);
    try {
      const res = await admin.deduplicateOpportunities();
      const confirmed = res.data?.confirmed_duplicates_removed ?? 0;
      const possible = res.data?.possible_duplicates_flagged ?? 0;
      setDedupResult(
        confirmed > 0
          ? `Done — removed ${confirmed} duplicate${confirmed !== 1 ? 's' : ''}${possible > 0 ? `, flagged ${possible} for review` : ''}.`
          : possible > 0
          ? `Done — flagged ${possible} possible duplicate${possible !== 1 ? 's' : ''} for review.`
          : 'Done — no duplicates found.'
      );
      // Refresh opportunities immediately since dedup already ran
      notifyOpportunitiesChanged();
      setTimeout(() => setDedupResult(null), 12_000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setDedupResult('Admin access required.');
      } else {
        setDedupResult('Deduplication failed. Check the server logs.');
      }
      setTimeout(() => setDedupResult(null), 8_000);
    } finally {
      setDeduplicating(false);
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

  async function handleApprove(id: string) {
    setApproving(id);
    try {
      await sources.update(id, { status: 'active' });
      fetchSources();
    } finally {
      setApproving(null);
    }
  }

  async function handleReject(id: string, name: string) {
    if (!confirm(`Remove "${name}" from sources? This cannot be undone.`)) return;
    setRejecting(id);
    try {
      await sources.delete(id);
      fetchSources();
    } finally {
      setRejecting(null);
    }
  }

  async function handleSaveDetail(id: string) {
    const draft = detailDraft[id];
    if (!draft) return;
    setSavingDetail(id);
    try {
      const parsedConfig = JSON.parse(draft._scraperConfigText || '{}');
      await sources.update(id, {
        name: draft.name,
        url: draft.url || undefined,
        notes: draft.notes || undefined,
        refresh_frequency: draft.refresh_frequency,
        relevant_themes: draft.relevant_themes,
        relevant_geographies: draft.relevant_geographies,
        scraper_config: parsedConfig,
      });
      fetchSources();
      setDetailError(prev => ({ ...prev, [id]: '' }));
    } catch {
      setDetailError(prev => ({ ...prev, [id]: 'Invalid JSON or save failed. Please check the Scraper Config field.' }));
    } finally {
      setSavingDetail(null);
    }
  }

  function initDetailDraft(s: Source) {
    setDetailDraft(prev => ({
      ...prev,
      [s.id]: {
        name: s.name,
        url: s.url ?? '',
        notes: s.notes ?? '',
        refresh_frequency: s.refresh_frequency ?? 'weekly',
        relevant_themes: s.relevant_themes ?? [],
        relevant_geographies: s.relevant_geographies ?? [],
        _scraperConfigText: JSON.stringify(s.scraper_config ?? {}, null, 2),
      },
    }));
  }

  const selectedTypeInfo = SOURCE_TYPES.find(t => t.value === newType);

  const tabs: { id: Tab; label: string; show?: boolean }[] = [
    // Shown to all institution members; GrantFiltersPanel gates the admin-only sections internally
    { id: 'sources', label: isAdmin ? 'Data Sources' : 'Grant Preferences', show: hasInstitution },
    // Org management — admin only
    { id: 'organization', label: 'Organization', show: isAdmin && hasInstitution },
    { id: 'profile', label: 'My Profile', show: true },
    { id: 'integrations', label: 'Integrations', show: true },
    { id: 'usage', label: 'Usage', show: true },
  ];

  const settingsInputStyle: React.CSSProperties = {
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-sunken)',
    color: 'var(--ink-primary)',
    outline: 'none',
    fontSize: '0.875rem',
    padding: '6px 12px',
    width: '100%',
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      {googleSuccess && (
        <div
          className="mx-7 mt-5 flex items-center gap-3 px-4 py-3"
          style={{
            background: 'var(--state-success-bg)',
            border: '1px solid var(--state-success)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--state-success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm" style={{ color: 'var(--state-success)' }}>Google account connected successfully.</p>
        </div>
      )}

      {/* Tab bar */}
      <div
        className="flex px-7 shrink-0"
        style={{ borderBottom: '1px solid var(--rule-subtle)' }}
      >
        {tabs
          .filter(t => t.show !== false)
          .map(t => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="relative pb-3 pt-5 pr-5 text-sm font-medium transition-colors"
                style={{ color: isActive ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--ink-secondary)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--ink-muted)'; }}
              >
                {t.label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-5 h-0.5"
                    style={{ background: 'var(--accent-primary)' }}
                  />
                )}
              </button>
            );
          })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-7 py-7">

      {/* Profile tab */}
      {activeTab === 'profile' && <ProfilePanel />}

      {/* Integrations tab */}
      {activeTab === 'integrations' && (
        <div className="max-w-lg space-y-6">
          <div>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--ink-primary)' }}>Integrations</h2>
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Connect external services to enhance your Grant Engine workflow.</p>
          </div>
          <GoogleIntegrationCard />
        </div>
      )}

      {/* Organization tab */}
      {activeTab === 'organization' && currentUser?.institution_id && (
        <div className="space-y-10">
          <MembersPanel institutionId={currentUser.institution_id} />
          <JoinRequestsPanel institutionId={currentUser.institution_id} />
          <InvitePanel institutionId={currentUser.institution_id} />
        </div>
      )}

      {/* Usage tab */}
      {activeTab === 'usage' && (
        <UsageTab user={authUser} />
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
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Data Sources</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>Manage grant discovery sources</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDedup}
              disabled={deduplicating}
              className="flex items-center gap-2 text-sm px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                color: 'var(--accent-primary)',
                border: '1px solid var(--accent-primary)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {deduplicating ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Deduplicating…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Deduplicate opportunities
                </>
              )}
            </button>
            <button
              onClick={handleScanAll}
              disabled={scanningAll || sourceList.length === 0}
              className="flex items-center gap-2 text-sm px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--accent-primary)',
                color: 'var(--ink-inverse)',
                borderRadius: 'var(--radius-sm)',
              }}
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
          </div>
          {dedupResult && (
            <p className="text-xs" style={{ color: 'var(--state-warning)' }}>{dedupResult}</p>
          )}
          {scanAllResult && (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{scanAllResult}</p>
          )}
        </div>
      </div>

      {/* Data Sources section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Data Sources</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
              Add websites, RSS feeds, or APIs to automatically discover new grant opportunities.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isPlatformAdmin && (
              <>
                <button
                  onClick={async () => {
                    setDiscoveringSource(true);
                    setDiscoverResult(null);
                    try {
                      await admin.discoverSources();
                      setDiscoverResult('Discovery task queued — check back in a few minutes.');
                    } catch {
                      setDiscoverResult('Failed to queue discovery task.');
                    } finally {
                      setDiscoveringSource(false);
                    }
                  }}
                  disabled={discoveringSource}
                  className="text-sm px-3 py-1.5 transition-colors disabled:opacity-50"
                  style={{
                    color: 'var(--accent-primary)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {discoveringSource ? 'Queuing…' : 'Run Discovery'}
                </button>
                <button
                  onClick={async () => {
                    setBackfillingTypes(true);
                    setBackfillResult(null);
                    try {
                      await admin.backfillOpportunityTypes();
                      setBackfillResult('Backfill task queued.');
                    } catch {
                      setBackfillResult('Failed to queue backfill task.');
                    } finally {
                      setBackfillingTypes(false);
                    }
                  }}
                  disabled={backfillingTypes}
                  className="text-sm px-3 py-1.5 transition-colors disabled:opacity-50"
                  style={{
                    color: 'var(--accent-primary)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {backfillingTypes ? 'Queuing…' : 'Backfill Types'}
                </button>
              </>
            )}
            <button
              onClick={() => { setShowAdd(!showAdd); }}
              className="text-sm px-3 py-1.5 transition-colors"
              style={{
                color: 'var(--accent-primary)',
                border: '1px solid var(--accent-primary)',
                borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {showAdd ? 'Cancel' : '+ Add source'}
            </button>
          </div>
        </div>
        {(discoverResult || backfillResult) && (
          <div className="mb-3 flex flex-col gap-1">
            {discoverResult && (
              <p
                className="text-xs px-3 py-2"
                style={{
                  color: 'var(--state-success)',
                  background: 'var(--state-success-bg)',
                  border: '1px solid var(--state-success)',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                {discoverResult}
              </p>
            )}
            {backfillResult && (
              <p
                className="text-xs px-3 py-2"
                style={{
                  color: 'var(--state-info)',
                  background: 'var(--state-info-bg)',
                  border: '1px solid var(--state-info)',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                {backfillResult}
              </p>
            )}
          </div>
        )}

        {/* Add source form */}
        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="mb-5 p-5 space-y-4"
            style={{
              border: '1px solid var(--rule-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-raised)',
            }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>New source</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Name *</label>
                <input
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Wellcome Trust Grants"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Source type</label>
                <select
                  value={newType}
                  onChange={e => { setNewType(e.target.value); setNewScraperConfig({}); }}
                  style={settingsInputStyle}
                >
                  {SOURCE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {selectedTypeInfo && (
                  <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>{selectedTypeInfo.hint}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>URL</label>
                <input
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  placeholder="https://…"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>API endpoint</label>
                <input
                  value={newApiEndpoint}
                  onChange={e => setNewApiEndpoint(e.target.value)}
                  placeholder="https://api.example.com/grants"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Category</label>
                <input
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="e.g. health, climate"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Relevant themes <span className="font-normal" style={{ color: 'var(--ink-faint)' }}>(comma-separated)</span>
                </label>
                <input
                  value={newThemes}
                  onChange={e => setNewThemes(e.target.value)}
                  placeholder="e.g. AI, global health, diagnostics"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Logo URL <span className="font-normal" style={{ color: 'var(--ink-faint)' }}>(optional)</span>
                </label>
                <input
                  value={newLogoUrl}
                  onChange={e => setNewLogoUrl(e.target.value)}
                  placeholder="https://…/logo.svg"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>Scan frequency</label>
                <select
                  value={newFrequency}
                  onChange={e => setNewFrequency(e.target.value)}
                  style={settingsInputStyle}
                >
                  {FREQUENCIES.map(f => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Notes <span className="font-normal" style={{ color: 'var(--ink-faint)' }}>(optional)</span>
                </label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Rate limits, auth requirements, scraping notes…"
                  rows={2}
                  className="resize-none"
                  style={settingsInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                />
              </div>
              <div className="flex items-center gap-4 col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="high_priority"
                    checked={newHighPriority}
                    onChange={e => setNewHighPriority(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="high_priority" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    High priority <span style={{ color: 'var(--ink-faint)' }}>(daily scans)</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="auth_required"
                    checked={newAuthRequired}
                    onChange={e => setNewAuthRequired(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="auth_required" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
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
                className="text-sm px-3 py-1.5 transition-colors"
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
                disabled={saving}
                className="text-sm px-4 py-1.5 transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--accent-primary)',
                  color: 'var(--ink-inverse)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {saving ? 'Adding…' : 'Add source'}
              </button>
            </div>
          </form>
        )}

        {/* Status filter tabs */}
        {(() => {
          const underReviewCount = sourceList.filter(s => s.status === 'under_review').length;
          const filterTabs: { id: typeof statusFilter; label: string; count?: number }[] = [
            { id: 'all', label: 'All', count: sourceList.length },
            { id: 'active', label: 'Active' },
            { id: 'under_review', label: 'Under Review', count: underReviewCount },
            { id: 'paused', label: 'Paused' },
            { id: 'broken', label: 'Broken' },
          ];
          return (
            <div className="flex items-center gap-1 mb-3 flex-wrap">
              {filterTabs.map(ft => {
                const isActive = statusFilter === ft.id;
                return (
                  <button
                    key={ft.id}
                    onClick={() => setStatusFilter(ft.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: isActive ? 'var(--accent-primary)' : 'var(--surface-sunken)',
                      color: isActive ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--rule-subtle)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
                  >
                    {ft.label}
                    {ft.id === 'under_review' && underReviewCount > 0 && (
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
                        style={{
                          background: isActive ? 'var(--state-warning)' : 'var(--state-warning-bg)',
                          color: isActive ? 'var(--ink-inverse)' : 'var(--state-warning)',
                        }}
                      >
                        {underReviewCount}
                      </span>
                    )}
                    {ft.id === 'all' && ft.count != null && (
                      <span className="mono-data text-[10px]" style={{ opacity: 0.7 }}>
                        {ft.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Source list table */}
        {(() => {
          const filteredSources = statusFilter === 'all'
            ? sourceList
            : sourceList.filter(s => s.status === statusFilter);
          return (
        <div style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
                <th className="text-left px-5 py-3 ledger-label">Source</th>
                <th className="text-left px-4 py-3 ledger-label hidden md:table-cell">Type / Endpoints</th>
                <th className="text-left px-4 py-3 ledger-label hidden lg:table-cell">Status</th>
                <th className="text-left px-4 py-3 ledger-label hidden lg:table-cell">Last run</th>
                <th className="text-right px-4 py-3 ledger-label">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</td></tr>
              ) : filteredSources.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>{statusFilter === 'all' ? 'No sources configured.' : `No ${statusFilter.replace('_', ' ')} sources.`}</p>
                    {statusFilter === 'all' && (
                      <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)', opacity: 0.7 }}>Add a source above to start automated grant discovery.</p>
                    )}
                  </td>
                </tr>
              ) : (
                filteredSources.map(s => (
                  <>
                  <tr
                    key={s.id}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderBottom: '1px solid var(--rule-subtle)',
                      background: s.status === 'under_review' ? 'var(--state-warning-bg)' : 'transparent',
                    }}
                    onClick={() => {
                      const next = expandedSource === s.id ? null : s.id;
                      setExpandedSource(next);
                      if (next) {
                        initDetailDraft(s);
                        fetchRunHistory(s.id);
                        setExpandedTab(prev => ({ ...prev, [s.id]: prev[s.id] ?? 'runs' }));
                      }
                    }}
                    onMouseEnter={e => { if (s.status !== 'under_review') e.currentTarget.style.background = 'var(--selection-bg)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = s.status === 'under_review' ? 'var(--state-warning-bg)' : 'transparent'; }}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        {s.logo_url ? (
                          <img src={s.logo_url} alt={s.name} className="w-5 h-5 rounded object-contain flex-shrink-0" onError={e => (e.currentTarget.style.display = 'none')} />
                        ) : (
                          <div
                            className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--surface-sunken)' }}
                          >
                            <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>{s.name.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--ink-primary)' }}>
                            {s.name}
                            {s.is_high_priority && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                                style={{ background: 'var(--state-warning-bg)', color: 'var(--state-warning)', border: '1px solid var(--state-warning)' }}
                              >
                                Priority
                              </span>
                            )}
                            {s.auth_required && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)', border: '1px solid var(--rule-subtle)' }}
                              >
                                Auth
                              </span>
                            )}
                          </div>
                          {s.category && (
                            <div className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>{s.category}</div>
                          )}
                          {(s.relevant_themes ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {s.relevant_themes!.slice(0, 5).map(t => (
                                <span
                                  key={t}
                                  className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                                  style={{ background: 'var(--state-info-bg)', color: 'var(--state-info)' }}
                                >
                                  {t}
                                </span>
                              ))}
                              {(s.relevant_themes!.length > 5) && (
                                <span className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>+{s.relevant_themes!.length - 5}</span>
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
                            className="block text-xs hover:underline truncate max-w-[200px]"
                            style={{ color: 'var(--accent-primary)' }}
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
                            className="block text-xs hover:underline truncate max-w-[200px]"
                            style={{ color: 'var(--state-info)' }}
                          >
                            API: {s.api_endpoint}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <div className="mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {formatDate(s.last_successful_run) ?? formatDate(s.last_checked) ?? 'Never'}
                      </div>
                      {s.opportunities_discovered != null && s.opportunities_discovered > 0 && (
                        <div className="mono-data text-[10px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                          {s.opportunities_discovered} found · {s.opportunities_added ?? 0} added
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                        {s.status === 'under_review' ? (
                          <>
                            <button
                              onClick={() => handleApprove(s.id)}
                              disabled={approving === s.id}
                              title="Approve — set source to active and queue a scan"
                              className="text-xs px-2.5 py-1 transition-colors disabled:opacity-40"
                              style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-xs)' }}
                            >
                              {approving === s.id ? 'Approving…' : 'Approve'}
                            </button>
                            <button
                              onClick={() => handleReject(s.id, s.name)}
                              disabled={rejecting === s.id}
                              title="Reject — remove this source"
                              className="text-xs px-2.5 py-1 transition-colors disabled:opacity-40"
                              style={{ color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-xs)', background: 'transparent' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {rejecting === s.id ? '…' : 'Reject'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleRunNow(s.id)}
                              disabled={running === s.id || s.status === 'paused'}
                              title="Run now"
                              className="text-xs px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-xs)' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {running === s.id ? 'Running…' : 'Run now'}
                            </button>
                            <button
                              onClick={() => handleToggle(s.id)}
                              disabled={toggling === s.id}
                              title={s.status === 'active' ? 'Pause' : 'Resume'}
                              className="text-xs px-2.5 py-1 transition-colors disabled:opacity-40"
                              style={{ color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-xs)', background: 'transparent' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {toggling === s.id ? '…' : s.status === 'active' ? 'Pause' : 'Resume'}
                            </button>
                            <button
                              onClick={() => handleDelete(s.id, s.name)}
                              disabled={deleting === s.id}
                              title="Delete source"
                              className="text-xs px-2.5 py-1 transition-colors disabled:opacity-40"
                              style={{ color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-xs)', background: 'transparent' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {deleting === s.id ? '…' : 'Delete'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedSource === s.id && (() => {
                    const draft = detailDraft[s.id];
                    if (!draft) return null;
                    const tab = expandedTab[s.id] ?? 'runs';
                    const discoveryConf = s.scraper_config?._discovery_confidence;
                    const discoveryNotes = s.scraper_config?._discovery_notes;
                    const jsonError = (() => {
                      try { JSON.parse(draft._scraperConfigText || '{}'); return ''; }
                      catch (e) { return (e as Error).message; }
                    })();
                    const runs = sourceRuns[s.id] ?? [];
                    return (
                    <tr key={`${s.id}-expanded`} style={{ background: 'var(--surface-sunken)' }}>
                      <td colSpan={5} className="px-5 py-5" style={{ borderTop: '1px solid var(--rule-subtle)' }}>

                        {/* Exa discovery banner */}
                        {s.status === 'under_review' && discoveryConf != null && (
                          <div
                            className="mb-4 p-3 flex items-start gap-3"
                            style={{
                              background: 'var(--state-warning-bg)',
                              border: '1px solid var(--state-warning)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--state-warning)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="text-xs">
                              <p className="font-semibold mb-0.5" style={{ color: 'var(--state-warning)' }}>Discovered by Exa AI</p>
                              <p style={{ color: 'var(--state-warning)' }}>Confidence: <span className="font-medium">{String(discoveryConf)}%</span></p>
                              {discoveryNotes != null && <p className="mt-0.5" style={{ color: 'var(--state-warning)' }}>{String(discoveryNotes)}</p>}
                            </div>
                          </div>
                        )}

                        {/* Sub-tabs: Run History / Edit Config */}
                        <div className="flex items-center gap-0 mb-4" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                          {(['runs', 'edit'] as const).map(t => {
                            const labels = { runs: 'Run History', edit: 'Edit Config' };
                            const isActive = tab === t;
                            return (
                              <button
                                key={t}
                                onClick={e => { e.stopPropagation(); setExpandedTab(prev => ({ ...prev, [s.id]: t })); }}
                                className="relative pb-2.5 pt-1 pr-5 text-xs font-medium transition-colors"
                                style={{ color: isActive ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
                                onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--ink-secondary)'; }}
                                onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--ink-muted)'; }}
                              >
                                {labels[t]}
                                {isActive && (
                                  <span className="absolute bottom-0 left-0 right-5 h-0.5" style={{ background: 'var(--accent-primary)' }} />
                                )}
                              </button>
                            );
                          })}
                          <div className="ml-auto">
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedSource(null); }}
                              className="text-xs px-2 py-1"
                              style={{ color: 'var(--ink-faint)' }}
                              title="Close"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* ── Run History tab ── */}
                        {tab === 'runs' && (
                          <div className="space-y-3">
                            {/* Source info row */}
                            <div className="flex flex-wrap items-center gap-3 text-xs pb-3" style={{ borderBottom: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}>
                              <TypeBadge type={s.source_type} />
                              {s.url && (
                                <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline" style={{ color: 'var(--accent-primary)' }}>
                                  {s.url.replace(/^https?:\/\//, '').slice(0, 60)}
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                </a>
                              )}
                              {s.api_endpoint && (
                                <a href={s.api_endpoint} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline" style={{ color: 'var(--state-info)' }}>
                                  API: {s.api_endpoint.replace(/^https?:\/\//, '').slice(0, 50)}
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                </a>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); fetchRunHistory(s.id); }}
                                className="ml-auto text-xs flex items-center gap-1 transition-colors"
                                style={{ color: 'var(--accent-primary)' }}
                                title="Refresh run history"
                              >
                                {loadingRuns === s.id ? (
                                  <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                ) : (
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                )}
                                Refresh
                              </button>
                            </div>

                            {loadingRuns === s.id ? (
                              <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-faint)' }}>Loading run history…</p>
                            ) : runs.length === 0 ? (
                              <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-faint)' }}>No runs recorded yet. Click Run now to trigger the first scan.</p>
                            ) : (
                              <div className="space-y-2">
                                {runs.map(run => {
                                  const isFailed = run.status === 'failed';
                                  const isSuccess = run.status === 'success';
                                  const hasWarnings = run.warnings?.length > 0;
                                  const runDiag = diagnoses[run.id];
                                  const duration = run.started_at && run.ended_at
                                    ? Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000)
                                    : null;

                                  return (
                                    <div
                                      key={run.id}
                                      className="p-3 space-y-2"
                                      style={{
                                        border: `1px solid ${isFailed ? 'var(--state-danger)' : hasWarnings ? 'var(--state-warning)' : 'var(--rule-subtle)'}`,
                                        borderRadius: 'var(--radius-sm)',
                                        background: isFailed ? 'var(--state-danger-bg)' : hasWarnings ? 'var(--state-warning-bg)' : 'var(--surface-panel)',
                                      }}
                                    >
                                      {/* Run header */}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span
                                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                                          style={{
                                            background: isFailed ? 'var(--state-danger)' : isSuccess ? 'var(--state-success)' : 'var(--state-warning)',
                                            color: 'var(--ink-inverse)',
                                          }}
                                        >
                                          {run.status.toUpperCase()}
                                        </span>
                                        <span className="mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                                          {run.started_at ? formatDate(run.started_at) : '—'}
                                        </span>
                                        {duration !== null && (
                                          <span className="mono-data text-[10px]" style={{ color: 'var(--ink-faint)' }}>{duration}s</span>
                                        )}
                                        <div className="ml-auto flex items-center gap-3 mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                                          <span title="Records fetched">{run.records_found ?? 0} fetched</span>
                                          <span title="New opportunities" style={{ color: run.new_opportunities > 0 ? 'var(--state-success)' : undefined }}>+{run.new_opportunities ?? 0} new</span>
                                          <span title="Duplicates skipped">{run.duplicates ?? 0} dupes</span>
                                        </div>
                                      </div>

                                      {/* Log summary */}
                                      {run.log_summary && (
                                        <p className="mono-data text-[10px] px-2 py-1.5 rounded" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                          {run.log_summary}
                                        </p>
                                      )}

                                      {/* Warnings */}
                                      {hasWarnings && (
                                        <div className="space-y-1">
                                          {run.warnings.map((w, i) => (
                                            <p key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--state-warning)' }}>
                                              <svg className="w-3 h-3 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                              {w}
                                            </p>
                                          ))}
                                        </div>
                                      )}

                                      {/* Errors */}
                                      {run.errors?.length > 0 && (
                                        <div className="space-y-1">
                                          {run.errors.map((err, i) => (
                                            <p key={i} className="mono-data text-[10px] px-2 py-1.5 rounded" style={{ background: 'var(--state-danger-bg)', color: 'var(--state-danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', border: '1px solid var(--state-danger)' }}>
                                              {err}
                                            </p>
                                          ))}
                                        </div>
                                      )}

                                      {/* Traceback (collapsed) */}
                                      {run.traceback && (
                                        <details className="text-[10px]">
                                          <summary className="cursor-pointer" style={{ color: 'var(--state-danger)', opacity: 0.8 }}>Full traceback</summary>
                                          <pre className="mt-1 px-2 py-1.5 rounded overflow-auto max-h-40 text-[10px]" style={{ background: 'var(--surface-base)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                            {run.traceback}
                                          </pre>
                                        </details>
                                      )}

                                      {/* Diagnosis result */}
                                      {runDiag && (
                                        <div className="mt-2 p-2.5 space-y-2 rounded" style={{ background: 'var(--state-info-bg)', border: '1px solid var(--state-info)' }}>
                                          <p className="text-[11px] font-semibold" style={{ color: 'var(--state-info)' }}>AI Diagnosis</p>
                                          <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>{runDiag.diagnosis}</p>
                                          {runDiag.root_cause && (
                                            <p className="mono-data text-[10px]" style={{ color: 'var(--ink-muted)' }}>Root cause: {runDiag.root_cause}</p>
                                          )}
                                          {runDiag.action_items?.length > 0 && (
                                            <ul className="list-disc list-inside space-y-0.5">
                                              {runDiag.action_items.map((item, i) => (
                                                <li key={i} className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>{item}</li>
                                              ))}
                                            </ul>
                                          )}
                                          {(runDiag.suggested_config || runDiag.suggested_type) && (
                                            <button
                                              onClick={e => { e.stopPropagation(); applyDiagnosisFix(s.id, run.id); }}
                                              className="text-[11px] px-2.5 py-1 transition-colors"
                                              style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-xs)' }}
                                            >
                                              Apply suggested config →
                                            </button>
                                          )}
                                        </div>
                                      )}

                                      {/* Diagnose button */}
                                      {!runDiag && (isFailed || run.new_opportunities === 0) && (
                                        <button
                                          onClick={e => { e.stopPropagation(); handleDiagnose(s.id, run.id); }}
                                          disabled={diagnosing === run.id}
                                          className="text-[11px] px-2.5 py-1 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                          style={{
                                            color: 'var(--accent-primary)',
                                            border: '1px solid var(--accent-primary)',
                                            borderRadius: 'var(--radius-xs)',
                                            background: 'transparent',
                                          }}
                                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
                                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                          {diagnosing === run.id ? (
                                            <>
                                              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                              Diagnosing…
                                            </>
                                          ) : (
                                            <>
                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                              Diagnose with AI
                                            </>
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── Edit Config tab ── */}
                        {tab === 'edit' && (
                          <div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              {/* Name */}
                              <div>
                                <label className="block ledger-label mb-1">Name</label>
                                <input
                                  value={draft.name}
                                  onChange={e => setDetailDraft(prev => ({ ...prev, [s.id]: { ...prev[s.id], name: e.target.value } }))}
                                  style={settingsInputStyle}
                                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                                />
                              </div>

                              {/* URL */}
                              <div>
                                <label className="block ledger-label mb-1">URL</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    value={draft.url}
                                    onChange={e => setDetailDraft(prev => ({ ...prev, [s.id]: { ...prev[s.id], url: e.target.value } }))}
                                    style={{ ...settingsInputStyle, flex: 1 }}
                                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                                    placeholder="https://…"
                                  />
                                  {draft.url && (
                                    <a href={draft.url} target="_blank" rel="noopener noreferrer" title="Open URL" style={{ color: 'var(--accent-primary)' }}>
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                    </a>
                                  )}
                                </div>
                              </div>

                              {/* Scraper type (read-only) */}
                              <div>
                                <label className="block ledger-label mb-1">Scraper Type</label>
                                <TypeBadge type={s.source_type} />
                              </div>

                              {/* Frequency */}
                              <div>
                                <label className="block ledger-label mb-1">Frequency</label>
                                <select
                                  value={draft.refresh_frequency}
                                  onChange={e => setDetailDraft(prev => ({ ...prev, [s.id]: { ...prev[s.id], refresh_frequency: e.target.value } }))}
                                  style={settingsInputStyle}
                                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                                >
                                  {FREQUENCIES.map(f => <option key={f} value={f} className="capitalize">{f}</option>)}
                                </select>
                              </div>

                              {/* Themes */}
                              <div className="md:col-span-2">
                                <label className="block ledger-label mb-1">
                                  Themes <span className="font-normal normal-case" style={{ color: 'var(--ink-faint)' }}>(comma-separated)</span>
                                </label>
                                <input
                                  value={draft.relevant_themes.join(', ')}
                                  onChange={e => setDetailDraft(prev => ({ ...prev, [s.id]: { ...prev[s.id], relevant_themes: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } }))}
                                  style={settingsInputStyle}
                                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                                  placeholder="e.g. health, education, arts"
                                />
                              </div>

                              {/* Notes */}
                              <div className="md:col-span-2">
                                <label className="block ledger-label mb-1">Notes</label>
                                <textarea
                                  value={draft.notes}
                                  onChange={e => setDetailDraft(prev => ({ ...prev, [s.id]: { ...prev[s.id], notes: e.target.value } }))}
                                  rows={2}
                                  className="resize-none"
                                  style={settingsInputStyle}
                                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
                                />
                              </div>

                              {/* Scraper Config JSON editor */}
                              <div className="md:col-span-2">
                                <label className="block ledger-label mb-1">
                                  Scraper Config <span className="font-normal normal-case" style={{ color: 'var(--ink-faint)' }}>(JSON)</span>
                                </label>
                                <textarea
                                  value={draft._scraperConfigText}
                                  onChange={e => setDetailDraft(prev => ({ ...prev, [s.id]: { ...prev[s.id], _scraperConfigText: e.target.value } }))}
                                  rows={8}
                                  spellCheck={false}
                                  className="resize-y"
                                  style={{
                                    ...settingsInputStyle,
                                    fontFamily: 'var(--font-mono, monospace)',
                                    ...(jsonError ? { borderColor: 'var(--state-danger)', background: 'var(--state-danger-bg)' } : {}),
                                  }}
                                  onFocus={e => (e.currentTarget.style.borderColor = jsonError ? 'var(--state-danger)' : 'var(--accent-primary)')}
                                  onBlur={e => (e.currentTarget.style.borderColor = jsonError ? 'var(--state-danger)' : 'var(--rule-subtle)')}
                                />
                                {jsonError && (
                                  <p className="mt-1 text-xs" style={{ color: 'var(--state-danger)' }}>JSON error: {jsonError}</p>
                                )}
                              </div>
                            </div>

                            {/* Save / error row */}
                            <div className="mt-4 flex items-center justify-between gap-3">
                              {detailError[s.id] && !jsonError && (
                                <p className="text-xs" style={{ color: 'var(--state-danger)' }}>{detailError[s.id]}</p>
                              )}
                              <div className="ml-auto flex items-center gap-2">
                                <button
                                  onClick={e => { e.stopPropagation(); setExpandedSource(null); }}
                                  className="text-xs px-3 py-1.5 transition-colors"
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
                                  onClick={e => { e.stopPropagation(); handleSaveDetail(s.id); }}
                                  disabled={savingDetail === s.id || Boolean(jsonError)}
                                  className="text-xs px-4 py-1.5 transition-colors disabled:opacity-50"
                                  style={{
                                    background: 'var(--accent-primary)',
                                    color: 'var(--ink-inverse)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  {savingDetail === s.id ? 'Saving…' : 'Save changes'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                      </td>
                    </tr>
                    );
                  })()}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
          );
        })()}

        {/* Scraper type legend */}
        <div
          className="mt-4 p-4"
          style={{
            background: 'var(--state-info-bg)',
            border: '1px solid var(--state-info)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--state-info)' }}>About source types</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {SOURCE_TYPES.map(t => (
              <div key={t.value} className="flex gap-2 text-xs" style={{ color: 'var(--state-info)' }}>
                <span className="font-medium w-32 shrink-0">{t.label}</span>
                <span style={{ opacity: 0.8 }}>{t.hint}</span>
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
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading settings…</div>}>
      <SettingsPageInner />
    </Suspense>
  );
}
