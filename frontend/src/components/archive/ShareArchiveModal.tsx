'use client';
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { archive } from '@/lib/api';

interface ShareTarget {
  kind: 'member' | 'partner' | 'email';
  email: string;
  name: string | null;
  organization: string | null;
  partner_id: string | null;
  is_internal: boolean;
}

interface Share {
  id: string;
  email: string;
  name: string | null;
  is_internal: boolean;
  has_account: boolean;
  shared_by: string | null;
}

interface Props {
  archiveId: string;
  title: string;
  onClose: () => void;
}

function errorText(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

/** Internal = already in your organization; External = anyone else. */
function ScopeBadge({ internal }: { internal: boolean }) {
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 shrink-0"
      style={{
        borderRadius: 'var(--radius-xs)',
        background: internal ? 'var(--state-info-bg)' : 'var(--state-warning-bg)',
        color: internal ? 'var(--state-info)' : 'var(--state-warning)',
      }}
    >
      {internal ? 'Internal' : 'External'}
    </span>
  );
}

function sourceLabel(t: ShareTarget): string {
  if (t.kind === 'member') return 'Your organization';
  if (t.kind === 'partner') return t.organization ? `Partner · ${t.organization}` : 'Partner';
  return 'Email address';
}

export default function ShareArchiveModal({ archiveId, title, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<ShareTarget[]>([]);
  const [selected, setSelected] = useState<ShareTarget | null>(null);
  const [note, setNote] = useState('');
  const [shares, setShares] = useState<Share[]>([]);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadShares = useCallback(() => {
    archive.listShares(archiveId)
      .then(res => setShares(res.data))
      .catch(err => setError(errorText(err, 'Could not load who this is shared with.')));
  }, [archiveId]);

  useEffect(() => { loadShares(); }, [loadShares]);

  useEffect(() => {
    if (selected) return;
    const t = setTimeout(() => {
      archive.shareTargets(query)
        .then(res => setTargets(res.data))
        .catch(() => setTargets([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sharedEmails = new Set(shares.map(s => s.email.toLowerCase()));

  async function handleShare() {
    if (!selected) return;
    setSharing(true); setError(''); setSuccess('');
    try {
      await archive.share(archiveId, {
        ...(selected.partner_id ? { partner_id: selected.partner_id } : { email: selected.email }),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSuccess(`Shared with ${selected.name || selected.email} — we emailed them a link.`);
      setSelected(null); setQuery(''); setNote('');
      loadShares();
    } catch (err) {
      setError(errorText(err, 'Could not share this grant.'));
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(s: Share) {
    setError(''); setSuccess('');
    try {
      await archive.unshare(archiveId, s.id);
      setShares(prev => prev.filter(x => x.id !== s.id));
    } catch (err) {
      setError(errorText(err, 'Could not remove access.'));
    }
  }

  const inputStyle = {
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-card)',
    color: 'var(--ink-primary)',
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--surface-overlay)' }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-archive-title"
        className="w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl"
        style={{ background: 'var(--surface-raised)', borderRadius: 'var(--radius-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
          <div className="min-w-0">
            <h3 id="share-archive-title" className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Share with…</h3>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1" style={{ color: 'var(--ink-faint)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {selected ? (
            <div className="flex items-center gap-2 px-3 py-2" style={{ ...inputStyle, background: 'var(--surface-sunken)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate" style={{ color: 'var(--ink-primary)' }}>{selected.name || selected.email}</div>
                {selected.name && <div className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{selected.email}</div>}
              </div>
              <ScopeBadge internal={selected.is_internal} />
              <button type="button" onClick={() => setSelected(null)} aria-label="Clear" className="p-0.5" style={{ color: 'var(--ink-faint)' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search partners and colleagues, or type an email"
                className="w-full px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <div className="mt-2 max-h-56 overflow-y-auto">
                {targets.length === 0 ? (
                  <p className="text-xs px-1 py-2" style={{ color: 'var(--ink-faint)' }}>
                    {query.trim() ? 'No matches. Type a full email address to share with anyone.' : 'No partners or colleagues with an email yet.'}
                  </p>
                ) : targets.map(t => {
                  const already = sharedEmails.has(t.email.toLowerCase());
                  return (
                    <button
                      key={`${t.kind}:${t.email}`}
                      type="button"
                      disabled={already}
                      onClick={() => { setSelected(t); setError(''); setSuccess(''); }}
                      className="w-full flex items-center gap-2 px-2 py-2 text-left disabled:opacity-50 hover:bg-[var(--surface-sunken)]"
                      style={{ borderBottom: '1px solid var(--rule-subtle)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate" style={{ color: 'var(--ink-primary)' }}>
                          {t.name || t.email}
                          {t.name && <span className="text-xs ml-1.5" style={{ color: 'var(--ink-muted)' }}>{t.email}</span>}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          {already ? 'Already shared' : sourceLabel(t)}
                        </div>
                      </div>
                      <ScopeBadge internal={t.is_internal} />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {selected && (
            <>
              <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>
                {selected.is_internal
                  ? 'In your organization — they can open it right away.'
                  : 'Outside your organization — they get an email to sign in or create an account, then see just this grant.'}
              </p>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Add a note (optional)"
                className="w-full mt-3 px-3 py-2 text-sm outline-none resize-none"
                style={inputStyle}
              />
              <div className="flex justify-end mt-3">
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={sharing}
                  className="px-3.5 py-1.5 text-sm font-medium disabled:opacity-60"
                  style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-sm)' }}
                >
                  {sharing ? 'Sharing…' : 'Share'}
                </button>
              </div>
            </>
          )}

          {error && <p role="alert" className="text-xs mt-3" style={{ color: 'var(--state-danger)' }}>{error}</p>}
          {success && <p className="text-xs mt-3" style={{ color: 'var(--state-success)' }}>{success}</p>}

          <div className="mt-5">
            <div className="ledger-label mb-1">Shared with · {shares.length}</div>
            {shares.length === 0 ? (
              <p className="text-xs py-2" style={{ color: 'var(--ink-faint)' }}>Not shared with anyone yet.</p>
            ) : shares.map(s => (
              <div key={s.id} className="flex items-center gap-2 py-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: 'var(--ink-primary)' }}>{s.name || s.email}</div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--ink-faint)' }}>
                    {s.name ? `${s.email} · ` : ''}{s.has_account ? 'Has an account' : 'Invited — not signed up yet'}
                    {s.shared_by ? ` · by ${s.shared_by}` : ''}
                  </div>
                </div>
                <ScopeBadge internal={s.is_internal} />
                <button type="button" onClick={() => handleUnshare(s)} title="Remove access" className="p-1" style={{ color: 'var(--ink-faint)' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
