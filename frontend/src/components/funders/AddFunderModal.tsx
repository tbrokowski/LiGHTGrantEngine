'use client';
// Add someone to Funders: pick a tier, then either tag a person already in
// Partners or create a new one (who also lands in Partners).
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { funders as fundersApi, partners as partnersApi } from '@/lib/api';
import CrmModal, { fieldStyle, errDetail } from '@/components/crm/CrmModal';
import { Avatar, Segmented, btnPrimary, btnQuiet } from '@/components/crm/crmUi';
import { TIERS, TierKey, TierMark, TierPill, tint } from './tiers';

interface Candidate { id: string; name: string; organization?: string | null; title?: string | null; funder_tier?: string | null }

export default function AddFunderModal({
  initialTier = 'unsorted', onClose, onAdded,
}: { initialTier?: TierKey; onClose: () => void; onAdded: (id: string) => void }) {
  const [tier, setTier] = useState<TierKey>(initialTier);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', organization: '', title: '', linkedin_url: '', email: '', city: '', country: '' });
  const [research, setResearch] = useState(true);

  useEffect(() => {
    if (mode !== 'existing') return;
    const t = setTimeout(() => {
      partnersApi.list({ q: q.trim() || undefined, limit: 30, sort_by: 'name', sort_dir: 'asc' })
        .then(r => setResults(r.data || []))
        .catch(() => setResults([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, mode]);

  async function addExisting(c: Candidate) {
    setBusyId(c.id);
    setError(null);
    try {
      await fundersApi.setTier(c.id, tier);
      onAdded(c.id);
    } catch (e) {
      setError(errDetail(e, 'Could not add them.'));
      setBusyId(null);
    }
  }

  async function createNew() {
    if (!form.name.trim()) { setError('A name is needed.'); return; }
    setBusyId('new');
    setError(null);
    try {
      const body: Record<string, unknown> = { tier, research };
      for (const [k, v] of Object.entries(form)) if (v.trim()) body[k] = v.trim();
      const res = await fundersApi.create(body);
      onAdded(res.data.id);
    } catch (e) {
      setError(errDetail(e, 'Could not create this funder.'));
      setBusyId(null);
    }
  }

  const chosen = TIERS.find(t => t.key === tier)!;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <CrmModal title="Add a funder" subtitle="Funders are partners too: they keep one record, tasks and history across both tabs."
      onClose={onClose} width="max-w-3xl" accent={chosen.color}
      footer={mode === 'new' ? (
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            <input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)} />
            Look them up online and fill in their profile
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-8 px-3 text-[13px]" style={btnQuiet}>Cancel</button>
            <button type="button" onClick={createNew} disabled={busyId === 'new'} className="h-8 px-3 text-[13px] font-medium disabled:opacity-50" style={btnPrimary}>
              {busyId === 'new' ? 'Adding…' : `Add as ${chosen.one}`}
            </button>
          </div>
        </div>
      ) : undefined}
    >
      <div className="px-6 py-5 flex flex-col gap-5">
        <section>
          <div className="ledger-label mb-2">Tier</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {TIERS.map(t => {
              const on = t.key === tier;
              return (
                <button key={t.key} type="button" onClick={() => setTier(t.key)} aria-pressed={on}
                  className="flex items-center gap-2 px-2 py-1.5 text-left rounded-[var(--radius-md)] transition-colors"
                  style={{
                    border: `1px solid ${on ? t.color : 'var(--rule-subtle)'}`,
                    background: on ? tint(t.color, '12') : 'var(--surface-base)',
                  }}
                  title={t.blurb}>
                  <TierMark tier={t} size={24} />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium truncate" style={{ color: on ? t.color : 'var(--ink-primary)' }}>{t.key === 'unsorted' ? 'Not sure yet' : t.label}</span>
                    {t.key !== 'unsorted' && <span className="block text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{t.kind}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>{chosen.emoji} {chosen.label}: {chosen.blurb}</p>
        </section>

        <section className="flex flex-col gap-3">
          <Segmented label="Who" value={mode} onChange={setMode}
            options={[{ value: 'existing', label: 'Someone in Partners' }, { value: 'new', label: 'New person' }]} />

          {mode === 'existing' ? (
            <>
              <label className="flex items-center gap-2 h-[34px] px-2.5" style={fieldStyle}>
                <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ink-muted)' }} />
                <input autoFocus aria-label="Search partners" value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search partners by name, organization…" className="flex-1 bg-transparent outline-none text-[13px]" />
              </label>
              <ul className="max-h-[260px] overflow-y-auto -mx-1">
                {results?.map(c => (
                  <li key={c.id} className="flex items-center gap-3 px-1 py-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                    <Avatar name={c.name} size={26} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate" style={{ color: 'var(--ink-primary)' }}>{c.name}</div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{[c.title, c.organization].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    {c.funder_tier && <TierPill tierKey={c.funder_tier} size="sm" />}
                    <button type="button" onClick={() => addExisting(c)} disabled={!!busyId || c.funder_tier === tier}
                      className="h-7 px-2.5 text-xs font-medium disabled:opacity-40" style={btnQuiet}>
                      {busyId === c.id ? 'Adding…' : c.funder_tier ? (c.funder_tier === tier ? 'Already here' : 'Move here') : 'Add'}
                    </button>
                  </li>
                ))}
                {results && !results.length && (
                  <li className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    No partner matches.{' '}
                    <button type="button" className="underline" onClick={() => { setMode('new'); setForm(f => ({ ...f, name: q })); }}>Create “{q}”</button>
                  </li>
                )}
              </ul>
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ['name', 'Name', 'Karin Jestin'],
                ['organization', 'Organization', 'Foundation, family office, bank…'],
                ['title', 'Title', 'CEO, Partner, Trustee…'],
                ['linkedin_url', 'LinkedIn', 'https://www.linkedin.com/in/…'],
                ['email', 'Email', 'name@example.org'],
                ['city', 'City', 'Geneva'],
                ['country', 'Country', 'Switzerland'],
              ] as const).map(([k, label, ph]) => (
                <label key={k} className={`flex flex-col gap-1 ${k === 'name' ? 'sm:col-span-2' : ''}`}>
                  <span className="ledger-label">{label}</span>
                  <input value={form[k]} onChange={set(k)} placeholder={ph} autoFocus={k === 'name'} className="h-[34px] px-2.5 text-[13px]" style={fieldStyle}
                    onKeyDown={e => { if (e.key === 'Enter') createNew(); }} />
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-xs" style={{ color: 'var(--state-danger)' }}>{error}</p>}
        </section>
      </div>
    </CrmModal>
  );
}
