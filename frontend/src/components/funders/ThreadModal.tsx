'use client';
// One open thread: start it (title, funders, first message), or read it,
// reply, assign or remove funders, rename, close/reopen and delete.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pencil, Search, Trash2, X } from 'lucide-react';
import { funderThreads } from '@/lib/api';
import { isInstitutionAdmin, useAuth } from '@/lib/auth';
import CrmModal, { errDetail, fieldStyle } from '@/components/crm/CrmModal';
import { Avatar, btnPrimary, btnQuiet } from '@/components/crm/crmUi';
import { TIER_BY_KEY, TierMark, tierRank } from './tiers';
import { FunderRow, funderHref } from './types';
import { FunderThread, ThreadFunder, whenLabel } from './threadTypes';

/** Search box over funders; picks one at a time. The list shows while focused. */
function FunderPicker({ options, onPick, placeholder = 'Assign a funder…' }: {
  options: FunderRow[];
  onPick: (f: FunderRow) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options
      .filter(f => !needle || [f.name, f.org_name, f.title].some(v => v && v.toLowerCase().includes(needle)))
      .sort((a, b) => tierRank(a.funder_tier) - tierRank(b.funder_tier) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [options, q]);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 h-8 px-2.5 text-[13px]" style={{ ...fieldStyle, color: 'var(--ink-muted)' }}>
        <Search className="w-3.5 h-3.5 shrink-0" />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} placeholder={placeholder}
          aria-label={placeholder}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter' && matches[0]) { e.preventDefault(); onPick(matches[0]); setQ(''); }
            if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
          }}
          className="flex-1 bg-transparent outline-none" style={{ color: 'var(--ink-primary)' }} />
      </label>
      {open && (
        <ul role="listbox" className="py-1" style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-base)' }}>
          {matches.map(f => {
            const t = TIER_BY_KEY[f.funder_tier];
            return (
              <li key={f.id}>
                <button type="button" role="option" aria-selected={false}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onPick(f); setQ(''); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-sunken)]">
                  {t && <TierMark tier={t} size={22} />}
                  <span className="text-[13px] font-medium truncate" style={{ color: 'var(--ink-primary)' }}>{f.name}</span>
                  {f.org_name && <span className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{f.org_name}</span>}
                </button>
              </li>
            );
          })}
          {!matches.length && (
            <li className="px-2.5 py-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              {options.length ? 'No funder matches.' : 'Everyone is already assigned.'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function FunderChip({ f, onRemove }: { f: ThreadFunder; onRemove?: () => void }) {
  const t = TIER_BY_KEY[f.funder_tier ?? ''];
  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-1 pr-1.5 rounded-full max-w-full"
      style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-base)' }}>
      {t ? <TierMark tier={t} size={20} /> : <Avatar name={f.name} size={20} />}
      <Link href={funderHref(f.id)} className="text-[12px] font-medium truncate hover:underline" style={{ color: 'var(--ink-primary)' }}>{f.name}</Link>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${f.name} from this thread`} title="Remove from thread"
          className="p-0.5 rounded-full hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-muted)' }}>
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

function NewThread({ funders, onClose, onCreated }: { funders: FunderRow[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<FunderRow[]>([]);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setError('Give the thread a title.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await funderThreads.create({ title: title.trim(), content: content.trim() || undefined, partner_ids: picked.map(f => f.id) });
      onCreated(r.data.id);
    } catch (e) {
      setError(errDetail(e, 'Could not start the thread.'));
      setBusy(false);
    }
  }

  return (
    <CrmModal title="New thread" subtitle="A conversation for the team, with the funders it's about." onClose={onClose} width="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <button type="button" onClick={onClose} className="h-8 px-3 text-[13px]" style={btnQuiet}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !title.trim()} className="h-8 px-3 text-[13px] font-medium disabled:opacity-50" style={btnPrimary}>
            {busy ? 'Starting…' : 'Start thread'}
          </button>
        </div>
      }>
      <div className="px-6 py-5 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus maxLength={300}
            placeholder="e.g. Swiss foundations push for the maternal health program"
            className="h-9 px-3 text-[13px]" style={fieldStyle} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="ledger-label">Funders</span>
          {picked.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {picked.map(f => <FunderChip key={f.id} f={f} onRemove={() => setPicked(p => p.filter(x => x.id !== f.id))} />)}
            </div>
          )}
          <FunderPicker options={funders.filter(f => !picked.some(p => p.id === f.id))} onPick={f => setPicked(p => [...p, f])} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">First message <span className="normal-case font-normal" style={{ color: 'var(--ink-faint)' }}>(optional)</span></span>
          <textarea rows={4} value={content} onChange={e => setContent(e.target.value)}
            placeholder="What's the plan, who's doing what…" className="px-3 py-2 text-[13px] resize-none" style={fieldStyle} />
        </label>
        {error && <p className="text-xs" style={{ color: 'var(--state-danger)' }}>{error}</p>}
      </div>
    </CrmModal>
  );
}

function ViewThread({ threadId, funders, onClose, onChanged }: {
  threadId: string; funders: FunderRow[]; onClose: () => void; onChanged: () => void;
}) {
  const { user } = useAuth();
  const [thread, setThread] = useState<FunderThread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    funderThreads.get(threadId).then(r => setThread(r.data)).catch(e => setLoadError(errDetail(e, 'Could not open this thread.')));
  }, [threadId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.posts?.length]);

  /** Run a change that returns the updated thread, then refresh the card. */
  const apply = useCallback(async (call: Promise<{ data: FunderThread }>, fail: string) => {
    try {
      const r = await call;
      setThread(r.data);
      onChanged();
      return true;
    } catch (e) {
      toast.error(errDetail(e, fail));
      return false;
    }
  }, [onChanged]);

  async function post() {
    if (!reply.trim() || posting) return;
    setPosting(true);
    if (await apply(funderThreads.post(threadId, reply.trim()), 'Could not post.')) setReply('');
    setPosting(false);
  }

  async function deletePost(postId: string) {
    try {
      await funderThreads.deletePost(threadId, postId);
      setThread(t => t && { ...t, posts: t.posts?.filter(p => p.id !== postId), post_count: Math.max(0, t.post_count - 1) });
      onChanged();
    } catch (e) { toast.error(errDetail(e, 'Could not delete that message.')); }
  }

  async function removeThread() {
    try {
      await funderThreads.remove(threadId);
      toast.success('Thread deleted');
      onChanged();
      onClose();
    } catch (e) { toast.error(errDetail(e, 'Could not delete the thread.')); }
  }

  const canDelete = !!thread && (thread.created_by === user?.id || isInstitutionAdmin(user));
  const assigned = new Set(thread?.funders.map(f => f.id));
  const closed = thread?.status === 'closed';

  return (
    <CrmModal title={thread?.title ?? (loadError ? 'Thread' : 'Loading…')} onClose={onClose} width="max-w-2xl"
      subtitle={thread && <>Started by {thread.created_by_name ?? 'someone'} · {whenLabel(thread.created_at)}{closed && ' · Closed'}</>}
      footer={thread && (
        <div className="flex items-end gap-2 w-full">
          <textarea rows={2} value={reply} onChange={e => setReply(e.target.value)} aria-label="Reply"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }}
            placeholder={closed ? 'Reply to reopen this thread…' : 'Write a reply…  (⌘↵ to post)'}
            className="flex-1 px-3 py-2 text-[13px] resize-none" style={fieldStyle} />
          <button type="button" onClick={post} disabled={!reply.trim() || posting} className="h-9 px-3.5 text-[13px] font-medium disabled:opacity-50" style={btnPrimary}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}>
      {loadError ? (
        <p className="px-6 py-8 text-sm text-center" style={{ color: 'var(--state-danger)' }}>{loadError}</p>
      ) : !thread ? (
        <div className="px-6 py-8 flex flex-col gap-3">{[0, 1, 2].map(i => <div key={i} className="h-10 animate-pulse rounded" style={{ background: 'var(--surface-sunken)' }} />)}</div>
      ) : (
        <div className="flex flex-col">
          {/* Actions */}
          <div className="px-6 py-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            {renaming !== null ? (
              <form className="flex items-center gap-2 flex-1 min-w-0"
                onSubmit={async e => { e.preventDefault(); if (renaming.trim() && await apply(funderThreads.update(threadId, { title: renaming.trim() }), 'Could not rename.')) setRenaming(null); }}>
                <input value={renaming} onChange={e => setRenaming(e.target.value)} autoFocus onFocus={e => e.target.select()} maxLength={300} aria-label="Thread title"
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }}
                  className="flex-1 min-w-0 h-8 px-2.5 text-[13px]" style={fieldStyle} />
                <button type="submit" disabled={!renaming.trim()} className="h-8 px-3 text-[12px] font-medium disabled:opacity-50" style={btnPrimary}>Save</button>
                <button type="button" onClick={() => setRenaming(null)} className="h-8 px-3 text-[12px]" style={btnQuiet}>Cancel</button>
              </form>
            ) : confirmDelete ? (
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <span className="text-[13px]" style={{ color: 'var(--state-danger)' }}>Delete this thread and all its messages? This can't be undone.</span>
                <button type="button" onClick={removeThread} className="h-8 px-3 text-[12px] font-medium"
                  style={{ background: 'var(--state-danger)', color: 'var(--ink-inverse)', borderRadius: 'var(--radius-md)' }}>Delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 px-3 text-[12px]" style={btnQuiet}>Cancel</button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => apply(funderThreads.update(threadId, { status: closed ? 'open' : 'closed' }), 'Could not update the thread.')}
                  className="h-8 px-3 text-[12px] font-medium" style={btnQuiet}>
                  {closed ? 'Reopen thread' : 'Close thread'}
                </button>
                <button type="button" onClick={() => setRenaming(thread.title)} className="h-8 px-3 text-[12px] inline-flex items-center gap-1.5" style={btnQuiet}>
                  <Pencil className="w-3 h-3" />Rename
                </button>
                {canDelete && (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto h-8 px-3 text-[12px] inline-flex items-center gap-1.5"
                    style={{ ...btnQuiet, color: 'var(--state-danger)' }}>
                    <Trash2 className="w-3 h-3" />Delete
                  </button>
                )}
              </>
            )}
          </div>

          {/* Funders */}
          <div className="px-6 py-4 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
            <span className="ledger-label">Funders on this thread</span>
            {thread.funders.length > 0 ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                {thread.funders.map(f => (
                  <FunderChip key={f.id} f={f} onRemove={() => apply(funderThreads.unassign(threadId, f.id), `Could not remove ${f.name}.`)} />
                ))}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>No one yet.</p>
            )}
            <FunderPicker options={funders.filter(f => !assigned.has(f.id))}
              onPick={f => apply(funderThreads.assign(threadId, f.id), `Could not assign ${f.name}.`)} />
          </div>

          {/* Messages */}
          <ul className="px-6 py-4 flex flex-col gap-4">
            {thread.posts?.map(p => (
              <li key={p.id} className="group flex items-start gap-3">
                <Avatar name={p.user_name || '?'} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>{p.user_name ?? 'Former member'}</span>
                    <span className="mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }} title={p.created_at ? new Date(p.created_at).toLocaleString() : undefined}>
                      {whenLabel(p.created_at)}
                    </span>
                    {p.user_id === user?.id && (
                      <button type="button" onClick={() => deletePost(p.id)} aria-label="Delete this message" title="Delete"
                        className="ml-auto p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[var(--surface-sunken)]" style={{ color: 'var(--ink-muted)' }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words mt-0.5" style={{ color: 'var(--ink-secondary)' }}>{p.content}</p>
                </div>
              </li>
            ))}
            {!thread.posts?.length && (
              <li className="py-4 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>No messages yet. Write the first one below.</li>
            )}
          </ul>
          <div ref={endRef} />
        </div>
      )}
    </CrmModal>
  );
}

export default function ThreadModal({ threadId, funders, onClose, onChanged, onCreated }: {
  /** null starts a new thread. */
  threadId: string | null;
  funders: FunderRow[];
  onClose: () => void;
  onChanged: () => void;
  onCreated: (id: string) => void;
}) {
  return threadId
    ? <ViewThread key={threadId} threadId={threadId} funders={funders} onClose={onClose} onChanged={onChanged} />
    : <NewThread funders={funders} onClose={onClose} onCreated={onCreated} />;
}
