'use client';
import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Compass, Search, X, Download, Upload, Plus, Trash2, UserCheck, Mail,
} from 'lucide-react';
import { partners as partnersApi } from '@/lib/api';
import PartnerForm, { PartnerFormData } from '@/components/crm/PartnerForm';
import CommandPalette from '@/components/crm/CommandPalette';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { SkeletonPartnerRow } from '@/components/ui/SkeletonCard';

type SortField = 'name' | 'organization' | 'last_contact';

interface Partner {
  id: string;
  name: string;
  email?: string;
  organization?: string;
  title?: string;
  department?: string;
  country?: string;
  tags: string[];
  h_index?: number;
  enrichment_status: string;
  updated_at?: string;
  owner_id?: string;
  owner_name?: string;
  grant_links_count?: number;
}

// Tags are faceted by prefix: `from:` (where they're from), `need:` (what we
// need from them), everything else is a general tag.
function TagChips({ tags }: { tags: string[] }) {
  const shown = tags.slice(0, 4);
  const extra = tags.length - shown.length;
  const style = (t: string): { bg: string; color: string; label: string } => {
    if (t.startsWith('from:')) return { bg: 'var(--state-info-bg)', color: 'var(--state-info)', label: `from: ${t.slice(5)}` };
    if (t.startsWith('need:')) return { bg: 'var(--state-warning-bg)', color: 'var(--state-warning)', label: `need: ${t.slice(5)}` };
    return { bg: 'var(--surface-sunken)', color: 'var(--ink-muted)', label: t };
  };
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(t => {
        const s = style(t);
        return (
          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]" style={{ background: s.bg, color: s.color }}>
            {s.label}
          </span>
        );
      })}
      {extra > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-faint)' }}>
          +{extra}
        </span>
      )}
    </div>
  );
}

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: 'asc' | 'desc' }) {
  const active = field === sortBy;
  const color = active ? 'var(--accent-primary)' : 'var(--rule-strong)';
  const rotate = active && sortDir === 'asc' ? 'rotate(180deg)' : undefined;
  return (
    <svg className="w-3 h-3 ml-1 inline" viewBox="0 0 10 6" fill="currentColor" style={{ color, transform: rotate }}>
      <path d="M0 0l5 6 5-6H0z" />
    </svg>
  );
}

function PartnersPageInner() {
  const router = useRouter();

  const [partnerList, setPartnerList] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<null | 'delete'>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [emailText, setEmailText] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const params: Record<string, unknown> = { sort_by: sortBy, sort_dir: sortDir };
      if (search) params.q = search;
      const res = await partnersApi.list(params);
      setPartnerList(res.data);
    } finally { setLoading(false); }
  }, [search, sortBy, sortDir]);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  function handleSort(field: SortField) {
    if (field === sortBy) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
  }

  async function handleCreate(data: PartnerFormData) {
    await partnersApi.create(data as unknown as Record<string, unknown>);
    setShowForm(false);
    fetchPartners();
  }

  async function handleEmailSubmit() {
    if (!emailText.trim()) return;
    setEmailBusy(true);
    setEmailError(null);
    try {
      const res = await partnersApi.fromEmailThread(emailText);
      setShowEmail(false);
      setEmailText('');
      if (res.data?.id) router.push(`/partners/${res.data.id}`);
      else fetchPartners();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setEmailError(detail || 'Couldn’t create a partner from that thread.');
    } finally { setEmailBusy(false); }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await partnersApi.importCsv(file);
      fetchPartners();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredPartners.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredPartners.map(p => p.id)));
  }

  async function handleBulkDelete() {
    await partnersApi.bulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    setBulkConfirm(null);
    fetchPartners();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await partnersApi.exportCsv();
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'partners.csv';
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  const filteredPartners = useMemo(() => {
    if (!search) return partnerList;
    const q = search.toLowerCase();
    return partnerList.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.organization || '').toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [partnerList, search]);

  const allSelected = filteredPartners.length > 0 && selectedIds.size === filteredPartners.length;
  const someSelected = selectedIds.size > 0;

  const selectStyle: React.CSSProperties = {
    border: '1px solid var(--rule-subtle)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-sunken)',
    color: 'var(--ink-secondary)',
    outline: 'none',
    fontSize: '0.875rem',
  };

  const outlineBtn: React.CSSProperties = {
    color: 'var(--accent-primary)',
    border: '1px solid var(--accent-primary)',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      {/* Header */}
      <div className="px-7 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>Partners</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
            {loading ? 'Loading…' : `${filteredPartners.length} partner${filteredPartners.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPalette(true)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 transition-colors"
            style={outlineBtn}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="text-xs px-1 py-0.5 hidden sm:inline" style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--radius-xs)', color: 'var(--ink-faint)' }}>⌘K</kbd>
          </button>
          <button
            onClick={() => setShowEmail(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 transition-colors"
            style={outlineBtn}
            title="Add a partner from a pasted email thread"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Mail className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add from email</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 transition-colors disabled:opacity-50"
            style={outlineBtn}
            title="Import partners from a CSV (columns: name, email, organization, title, tags)"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{importing ? 'Importing…' : 'Import CSV'}</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} />
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 transition-colors disabled:opacity-50"
            style={outlineBtn}
            title="Export CSV"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--state-info-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <Link
            href="/partners/find"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 font-medium transition-colors"
            style={{ ...outlineBtn, opacity: 0.85 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Find Partners</span>
          </Link>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 font-medium transition-colors"
            style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}
          >
            <Plus className="w-3.5 h-3.5" />New
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-7 py-3 flex flex-wrap items-center gap-2 shrink-0">
        <input
          type="text"
          placeholder="Search by name, email, org, tag…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 text-sm w-72"
          style={selectStyle}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--rule-subtle)')}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-sm flex items-center gap-1 transition-colors"
            style={{ color: 'var(--ink-faint)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-faint)')}
          >
            <X className="w-3.5 h-3.5" />Clear
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div
          className="mx-7 mb-3 flex items-center gap-2 px-4 py-2.5"
          style={{ background: 'var(--state-info-bg)', border: '1px solid var(--state-info)', borderRadius: 'var(--radius-sm)', color: 'var(--state-info)' }}
        >
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 text-xs px-2.5 py-1 transition-colors"
              style={{ border: '1px solid var(--state-info)', borderRadius: 'var(--radius-xs)' }}
            >
              <Download className="w-3 h-3" />Export
            </button>
            <button
              onClick={() => setBulkConfirm('delete')}
              className="flex items-center gap-1 text-xs px-2.5 py-1 transition-colors"
              style={{ color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-xs)', background: 'transparent' }}
            >
              <Trash2 className="w-3 h-3" />Delete
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-7 pb-6">
        <div style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-subtle)', background: 'var(--surface-sunken)' }}>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" />
                </th>
                <th className="text-left px-4 py-3 ledger-label">
                  <button onClick={() => handleSort('name')} className="flex items-center hover:opacity-80">
                    Name <SortIcon field="name" sortBy={sortBy} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 ledger-label hidden md:table-cell">
                  <button onClick={() => handleSort('organization')} className="flex items-center hover:opacity-80">
                    Organization <SortIcon field="organization" sortBy={sortBy} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 ledger-label">Tags</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonPartnerRow key={i} />)
              ) : filteredPartners.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>
                    {search ? 'No matches found.' : 'No partners yet. Add your first partner.'}
                  </td>
                </tr>
              ) : filteredPartners.map(p => (
                <tr
                  key={p.id}
                  className="transition-colors"
                  style={{ borderBottom: '1px solid var(--rule-subtle)', background: selectedIds.has(p.id) ? 'var(--state-info-bg)' : 'transparent' }}
                  onMouseEnter={e => { if (!selectedIds.has(p.id)) e.currentTarget.style.background = 'var(--selection-bg)'; }}
                  onMouseLeave={e => { if (!selectedIds.has(p.id)) e.currentTarget.style.background = 'transparent'; }}
                >
                  <td className="px-4 py-3 w-8">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded" />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/partners/${p.id}`}
                      className="font-medium block transition-colors"
                      style={{ color: 'var(--ink-primary)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-primary)')}
                    >
                      {p.name}
                    </Link>
                    {p.email && <div className="mono-data text-[11px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>{p.email}</div>}
                    {p.title && <div className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: 'var(--ink-faint)' }}>{p.title}</div>}
                    {p.owner_name && (
                      <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                        <UserCheck className="w-3 h-3" />{p.owner_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="truncate max-w-[180px] text-sm" style={{ color: 'var(--ink-muted)' }}>{p.organization ?? '—'}</div>
                    {p.department && <div className="text-xs truncate max-w-[180px]" style={{ color: 'var(--ink-faint)' }}>{p.department}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <TagChips tags={p.tags} />
                      {p.h_index != null && (
                        <span
                          className="mono-data text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)]"
                          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)', border: '1px solid var(--rule-subtle)' }}
                        >
                          h:{p.h_index}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Partner Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
          >
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>New Partner</h2>
              <button onClick={() => setShowForm(false)} className="text-xl" style={{ color: 'var(--ink-faint)' }}>×</button>
            </div>
            <div className="px-6 py-5">
              <PartnerForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="Create partner" />
            </div>
          </div>
        </div>
      )}

      {/* Add-from-email Modal */}
      {showEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }}>
          <div
            className="w-full max-w-xl"
            style={{ background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--rule-subtle)', boxShadow: 'var(--shadow-floating)' }}
          >
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Add partner from email thread</h2>
              <button onClick={() => { setShowEmail(false); setEmailError(null); }} className="text-xl" style={{ color: 'var(--ink-faint)' }}>×</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                Paste an email thread. We’ll pull the external contact, find their LinkedIn, and enrich their profile automatically.
              </p>
              <textarea
                value={emailText}
                onChange={e => setEmailText(e.target.value)}
                rows={10}
                placeholder="Paste the full email thread here…"
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ borderColor: 'var(--rule-subtle)' }}
              />
              {emailError && <p className="text-xs" style={{ color: 'var(--state-danger)' }}>{emailError}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowEmail(false); setEmailError(null); }}
                  className="flex-1 text-sm py-2 border rounded-lg font-medium"
                  style={{ borderColor: 'var(--rule-subtle)', color: 'var(--ink-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmailSubmit}
                  disabled={emailBusy || !emailText.trim()}
                  className="flex-1 text-sm py-2 rounded-lg font-medium disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
                >
                  {emailBusy ? 'Extracting…' : 'Create partner'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} onNewPartner={() => setShowForm(true)} />}

      {bulkConfirm === 'delete' && (
        <ConfirmModal
          title={`Delete ${selectedIds.size} partner${selectedIds.size !== 1 ? 's' : ''}?`}
          message="This will permanently delete the selected partner records, their reminders, meetings, and documents. This cannot be undone."
          confirmLabel="Delete All"
          destructive
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkConfirm(null)}
        />
      )}
    </div>
  );
}

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24 text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}>
      <PartnersPageInner />
    </Suspense>
  );
}
