'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { messages as messagesApi, notifications as notificationsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  useInboxCounts, notifyInboxChanged, relativeTime, initials, avatarColor, NOTIFICATION_LABEL,
  type ConversationItem, type MessageItem, type NotificationItem, type Person,
} from '@/lib/inbox';

const THREAD_POLL_MS = 5_000;
const LIST_POLL_MS = 15_000;

// ── Small pieces ─────────────────────────────────────────────────────────────

function Avatar({ name, size = 28, group }: { name?: string | null; size?: number; group?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center font-semibold text-white shrink-0"
      style={{
        width: size, height: size, fontSize: size < 30 ? 10 : 12,
        background: group ? 'var(--ink-muted)' : avatarColor(name),
      }}
    >
      {group ? group : initials(name)}
    </span>
  );
}

function PanelHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      className="px-5 py-3 flex items-center justify-between gap-3 shrink-0"
      style={{ background: 'var(--panel-header-bg)', borderBottom: '1px solid var(--panel-header-rule)' }}
    >
      <div className="min-w-0 flex items-center gap-2.5">{children}</div>
      {right}
    </div>
  );
}

function GhostButton({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-1 rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--selection-bg)]"
      style={{ color: danger ? 'var(--state-danger)' : 'var(--ink-muted)' }}
    >
      {children}
    </button>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── People picker modal (new conversation / add people) ─────────────────────

function PeoplePicker({
  title, confirmLabel, exclude = [], allowGroupName, allowMessage, onClose, onConfirm,
}: {
  title: string;
  confirmLabel: string;
  exclude?: string[];
  allowGroupName?: boolean;
  allowMessage?: boolean;
  onClose: () => void;
  onConfirm: (ids: string[], groupName: string, body: string) => Promise<void>;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesApi.people().then(r => setPeople(r.data)).catch(() => setPeople([]));
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = (people ?? []).filter(p =>
    !exclude.includes(p.id) &&
    (p.name.toLowerCase().includes(query.toLowerCase()) || (p.email ?? '').toLowerCase().includes(query.toLowerCase()))
  );
  const byId = Object.fromEntries((people ?? []).map(p => [p.id, p]));
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const submit = async () => {
    if (!selected.length || saving) return;
    setSaving(true);
    try { await onConfirm(selected, groupName.trim(), body.trim()); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-full max-w-md mx-4 overflow-hidden flex flex-col"
        style={{ background: 'var(--surface-raised)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', maxHeight: '80vh' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <PanelHeader right={<GhostButton onClick={onClose}>Cancel</GhostButton>}>
          <span className="text-sm font-semibold" style={{ color: 'var(--panel-header-text)' }}>{title}</span>
        </PanelHeader>

        <div className="px-5 pt-4 pb-2 space-y-3">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map(id => (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  className="flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--selection-bg)', color: 'var(--ink-secondary)' }}
                  title="Remove"
                >
                  {byId[id]?.name ?? 'Someone'} <span style={{ color: 'var(--ink-faint)' }}>×</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search people in your organization"
            className="w-full text-sm px-3 py-2 rounded-[var(--radius-sm)] outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-[120px]" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {people === null ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-5 py-6 text-sm text-center" style={{ color: 'var(--ink-muted)' }}>
              {people.length === 0 ? 'No one else is in your organization yet' : 'No matches'}
            </p>
          ) : visible.map(p => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="ledger-row w-full text-left px-5 py-2 flex items-center gap-3"
                style={on ? { background: 'var(--selection-bg)' } : undefined}
              >
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] truncate" style={{ color: 'var(--ink-primary)', fontWeight: on ? 600 : 400 }}>{p.name}</p>
                  {p.email && <p className="text-[11px] truncate" style={{ color: 'var(--ink-faint)' }}>{p.email}</p>}
                </div>
                <span
                  className="w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0"
                  style={{ border: `1px solid ${on ? 'var(--accent-primary)' : 'var(--rule-strong)'}`, background: on ? 'var(--accent-primary)' : 'transparent' }}
                >
                  {on && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
          {allowGroupName && selected.length > 1 && (
            <input
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="Group name (optional)"
              maxLength={200}
              className="w-full text-sm px-3 py-2 rounded-[var(--radius-sm)] outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
            />
          )}
          {allowMessage && (
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write a message (optional)"
              rows={2}
              className="w-full text-sm px-3 py-2 rounded-[var(--radius-sm)] outline-none resize-none focus:ring-2 focus:ring-[var(--focus-ring)]"
              style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
            />
          )}
          <button
            onClick={submit}
            disabled={!selected.length || saving}
            className="w-full text-sm font-medium py-2 rounded-[var(--radius-sm)] transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
          >
            {saving ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Thread ───────────────────────────────────────────────────────────────────

type Row =
  | { kind: 'day'; label: string; key: string }
  | { kind: 'msg'; m: MessageItem; continued: boolean; key: string };

function Thread({
  conversation, currentUserId, onChanged, onLeft,
}: {
  conversation: ConversationItem;
  currentUserId: string | null;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [items, setItems] = useState<MessageItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title ?? '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastTs = useRef<string | null>(null);
  const cid = conversation.id;

  // Held in a ref so a new parent callback doesn't re-run the load effects.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const markRead = useCallback(() => {
    messagesApi.markRead(cid).then(() => { notifyInboxChanged(); onChangedRef.current(); }).catch(() => null);
  }, [cid]);

  const append = useCallback((incoming: MessageItem[]) => {
    if (!incoming.length) return;
    setItems(prev => {
      const seen = new Set((prev ?? []).map(m => m.id));
      return [...(prev ?? []), ...incoming.filter(m => !seen.has(m.id))];
    });
    lastTs.current = incoming[incoming.length - 1].created_at ?? lastTs.current;
  }, []);

  // Initial load.
  useEffect(() => {
    let live = true;
    setItems(null);
    lastTs.current = null;
    stickToBottom.current = true;
    messagesApi.list(cid, { limit: 50 }).then(r => {
      if (!live) return;
      const list = r.data.items as MessageItem[];
      setItems(list);
      setHasMore(r.data.has_more);
      lastTs.current = list.length ? list[list.length - 1].created_at : null;
      markRead();
    }).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [cid, markRead]);

  // Poll for new messages while visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || items === null) return;
      const params = lastTs.current ? { after: lastTs.current } : { limit: 50 };
      messagesApi.list(cid, params).then(r => {
        const fresh = (r.data.items as MessageItem[]);
        if (fresh.length) {
          append(fresh);
          if (fresh.some(m => m.sender_id !== currentUserId)) markRead();
        }
      }).catch(() => null);
    }, THREAD_POLL_MS);
    return () => window.clearInterval(id);
  }, [cid, items, append, markRead, currentUserId]);

  // Keep the view pinned to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    if (!items?.length || !items[0].created_at) return;
    const el = scrollRef.current;
    const before = el ? el.scrollHeight : 0;
    const r = await messagesApi.list(cid, { before: items[0].created_at, limit: 50 }).catch(() => null);
    if (!r) return;
    stickToBottom.current = false;
    setItems(prev => [...(r.data.items as MessageItem[]), ...(prev ?? [])]);
    setHasMore(r.data.has_more);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await messagesApi.send(cid, body);
      stickToBottom.current = true;
      append([r.data as MessageItem]);
      setDraft('');
      onChanged();
    } catch {
      toast.error('Message not sent');
    } finally {
      setSending(false);
    }
  };

  const saveTitle = async () => {
    setRenaming(false);
    if ((conversation.title ?? '') === titleDraft.trim()) return;
    await messagesApi.updateConversation(cid, { title: titleDraft.trim() }).catch(() => toast.error('Could not rename'));
    onChanged();
  };

  const leave = async () => {
    if (!window.confirm('Leave this group? You will stop receiving its messages.')) return;
    await messagesApi.leave(cid).catch(() => toast.error('Could not leave'));
    onLeft();
  };

  const others = conversation.members.filter(m => m.id !== currentUserId);

  // Group consecutive messages by sender and day.
  const rows = useMemo(() => {
    const out: Row[] = [];
    let lastDay = '';
    let lastSender: string | null | undefined;
    let lastTime = 0;
    for (const m of items ?? []) {
      const created = m.created_at ?? new Date().toISOString();
      const day = new Date(created).toDateString();
      if (day !== lastDay) {
        out.push({ kind: 'day', label: dayLabel(created), key: `d-${day}` });
        lastDay = day;
        lastSender = undefined;
      }
      const t = new Date(created).getTime();
      const continued = m.sender_id === lastSender && t - lastTime < 5 * 60_000;
      out.push({ kind: 'msg', m, continued, key: m.id });
      lastSender = m.sender_id;
      lastTime = t;
    }
    return out;
  }, [items]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <PanelHeader
        right={
          conversation.is_group ? (
            <div className="flex items-center gap-1 shrink-0">
              <GhostButton onClick={() => setAdding(true)}>Add people</GhostButton>
              <GhostButton onClick={() => { setTitleDraft(conversation.title ?? ''); setRenaming(true); }}>Rename</GhostButton>
              <GhostButton onClick={leave} danger>Leave</GhostButton>
            </div>
          ) : undefined
        }
      >
        <Avatar name={conversation.display_name} group={conversation.is_group ? conversation.members.length : undefined} />
        <div className="min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setRenaming(false); }}
              placeholder="Group name"
              maxLength={200}
              className="text-sm font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] outline-none"
              style={{ border: '1px solid var(--rule-strong)', background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
            />
          ) : (
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--panel-header-text)' }}>{conversation.display_name}</p>
          )}
          <p className="text-[11px] truncate" style={{ color: 'var(--ink-faint)' }}>
            {conversation.is_group
              ? `${conversation.members.length} members · ${conversation.members.map(m => m.name.split(' ')[0]).join(', ')}`
              : others[0]?.email ?? 'Direct message'}
          </p>
        </div>
      </PanelHeader>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 py-4">
        {items === null ? (
          <p className="py-10 text-sm text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No messages yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>Say hello below</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="text-center pb-3">
                <GhostButton onClick={loadOlder}>Load earlier messages</GhostButton>
              </div>
            )}
            {rows.map(r => r.kind === 'day' ? (
              <div key={r.key} className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px" style={{ background: 'var(--rule-subtle)' }} />
                <span className="ledger-label">{r.label}</span>
                <div className="flex-1 h-px" style={{ background: 'var(--rule-subtle)' }} />
              </div>
            ) : (
              <div key={r.key} className={`flex gap-3 ${r.continued ? 'mt-0.5' : 'mt-3'}`}>
                <div style={{ width: 28 }} className="shrink-0">
                  {!r.continued && <Avatar name={r.m.sender_name} />}
                </div>
                <div className="min-w-0 flex-1">
                  {!r.continued && (
                    <p className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                        {r.m.sender_id === currentUserId ? 'You' : (r.m.sender_name ?? 'Former member')}
                      </span>
                      {r.m.created_at && (
                        <span className="mono-data text-[10px]" style={{ color: 'var(--ink-faint)' }}>{timeLabel(r.m.created_at)}</span>
                      )}
                    </p>
                  )}
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--ink-secondary)' }}>
                    {r.m.body}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
        <div
          className="flex items-end gap-2 px-3 py-2 rounded-[var(--radius-md)]"
          style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-raised)' }}
        >
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }}
            rows={Math.min(6, Math.max(1, draft.split('\n').length))}
            placeholder={`Message ${conversation.display_name}`}
            className="flex-1 text-[13px] bg-transparent outline-none resize-none py-1"
            style={{ color: 'var(--ink-primary)', outline: 'none', boxShadow: 'none' }}
            maxLength={8000}
          />
          <button
            onClick={send}
            disabled={!draft.trim() || sending}
            className="text-[12px] font-medium px-3 py-1.5 rounded-[var(--radius-sm)] transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
          >
            Send
          </button>
        </div>
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>Enter to send · Shift+Enter for a new line</p>
      </div>

      {adding && (
        <PeoplePicker
          title="Add people"
          confirmLabel="Add to group"
          exclude={conversation.members.map(m => m.id)}
          onClose={() => setAdding(false)}
          onConfirm={async ids => {
            try {
              await messagesApi.updateConversation(cid, { add_member_ids: ids });
              setAdding(false);
              onChanged();
            } catch { toast.error('Could not add people'); }
          }}
        />
      )}
    </div>
  );
}

// ── Notifications list ───────────────────────────────────────────────────────

const NOTE_FILTERS: { key: string; label: string; match: (t: string) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'messages', label: 'Messages', match: t => t === 'new_message' || t === 'comment_mention' },
  { key: 'tasks', label: 'Tasks', match: t => t.startsWith('task_') },
  { key: 'invitations', label: 'Invitations', match: t => t.endsWith('_invitation') || t === 'org_join_request' },
  { key: 'updates', label: 'Updates', match: t => !t.startsWith('task_') && !t.endsWith('_invitation') && t !== 'new_message' && t !== 'comment_mention' && t !== 'org_join_request' },
];

function NotificationsPane() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(() => {
    notificationsApi.list({ limit: 200 }).then(r => setItems(r.data)).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const match = NOTE_FILTERS.find(f => f.key === filter)!.match;
  const visible = (items ?? []).filter(n => match(n.notification_type) && (!unreadOnly || !n.is_read));
  const unread = (items ?? []).filter(n => !n.is_read).length;

  const open = async (n: NotificationItem) => {
    if (!n.is_read) {
      setItems(xs => xs?.map(x => (x.id === n.id ? { ...x, is_read: true } : x)) ?? xs);
      await notificationsApi.markRead(n.id).catch(() => null);
      notifyInboxChanged();
    }
    if (n.link) router.push(n.link);
  };

  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => null);
    setItems(xs => xs?.map(x => ({ ...x, is_read: true })) ?? xs);
    notifyInboxChanged();
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      <PanelHeader
        right={unread > 0 ? <GhostButton onClick={markAll}>Mark all read</GhostButton> : undefined}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--panel-header-text)' }}>Notifications</span>
        {unread > 0 && (
          <span className="mono-data text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)]" style={{ background: 'rgba(28,60,114,0.12)', color: 'var(--panel-header-text)' }}>
            {unread} unread
          </span>
        )}
      </PanelHeader>
      <div className="px-5 py-2.5 flex flex-wrap items-center gap-1.5 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        {NOTE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="text-[12px] px-2.5 py-1 rounded-full transition-colors"
            style={{
              background: filter === f.key ? 'var(--accent-primary)' : 'transparent',
              color: filter === f.key ? 'var(--ink-inverse)' : 'var(--ink-muted)',
              border: `1px solid ${filter === f.key ? 'var(--accent-primary)' : 'var(--rule-subtle)'}`,
            }}
          >
            {f.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items === null ? (
          <p className="py-10 text-sm text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>You&apos;re all caught up</p>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>Task updates, invitations and messages will show up here</p>
          </div>
        ) : visible.map(n => (
          <button key={n.id} onClick={() => open(n)} className="ledger-row w-full text-left px-5 py-3 flex items-start gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: n.is_read ? 'transparent' : 'var(--state-info)' }} />
            {n.actor_name ? <Avatar name={n.actor_name} /> : (
              <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug" style={{ color: n.is_read ? 'var(--ink-muted)' : 'var(--ink-primary)', fontWeight: n.is_read ? 400 : 500 }}>
                {n.message}
              </p>
              <p className="mono-data text-[10px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                {NOTIFICATION_LABEL[n.notification_type] ?? 'Update'}  ·  {relativeTime(n.created_at)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function MessagesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const counts = useInboxCounts();
  const tab = params.get('tab') === 'notifications' ? 'notifications' : 'messages';
  const selectedId = params.get('c');
  const [convs, setConvs] = useState<ConversationItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);

  const loadConvs = useCallback(() => {
    messagesApi.conversations().then(r => setConvs(r.data)).catch(() => setConvs(c => c ?? []));
  }, []);
  useEffect(() => { loadConvs(); }, [loadConvs]);
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') loadConvs(); }, LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadConvs]);

  const go = (q: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(q).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    router.replace(`/messages${next.toString() ? `?${next}` : ''}`);
  };

  // Open the most recent conversation by default on wide screens.
  useEffect(() => {
    if (tab === 'messages' && !selectedId && convs?.length && window.innerWidth >= 1024) go({ c: convs[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedId, convs]);

  const selected = convs?.find(c => c.id === selectedId) ?? null;
  const visibleConvs = (convs ?? []).filter(c =>
    !query || c.display_name.toLowerCase().includes(query.toLowerCase()) ||
    c.members.some(m => m.name.toLowerCase().includes(query.toLowerCase()))
  );

  const refreshCounts = counts.refresh;
  const refreshAll = useCallback(() => { loadConvs(); refreshCounts(); }, [loadConvs, refreshCounts]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)' }}>
      {/* Header */}
      <div className="px-8 pt-6 pb-5 flex items-end justify-between gap-4 shrink-0" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
        <div>
          <p className="ledger-label mb-1.5" style={{ color: 'var(--panel-header-text)', opacity: 0.6 }}>Inbox</p>
          <h1 className="font-semibold tracking-tight" style={{ fontSize: '22px', color: 'var(--ink-primary)', letterSpacing: '-0.02em' }}>
            Messages
          </h1>
        </div>
        <button
          onClick={() => setComposing(true)}
          className="text-[13px] font-medium px-3.5 py-2 rounded-[var(--radius-sm)]"
          style={{ background: 'var(--accent-primary)', color: 'var(--ink-inverse)' }}
        >
          New message
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 p-5">
        <div
          className="h-full flex overflow-hidden"
          style={{ border: '1px solid var(--rule-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-raised)' }}
        >
          {/* Left rail */}
          <div
            className={`flex-col w-full lg:w-[320px] shrink-0 ${(tab === 'messages' && selected) || tab === 'notifications' ? 'hidden lg:flex' : 'flex'}`}
            style={{ borderRight: '1px solid var(--rule-subtle)' }}
          >
            <div className="px-3 pt-3 pb-2 flex gap-1 shrink-0">
              {(['messages', 'notifications'] as const).map(t => {
                const n = t === 'messages' ? counts.messages : counts.notifications;
                const on = tab === t;
                return (
                  <button
                    key={t}
                    onClick={() => go({ tab: t === 'messages' ? null : t, c: null })}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[12px] py-1.5 rounded-[var(--radius-sm)] transition-colors"
                    style={{
                      background: on ? 'var(--selection-bg)' : 'transparent',
                      color: on ? 'var(--ink-primary)' : 'var(--ink-muted)',
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {t === 'messages' ? 'Messages' : 'Notifications'}
                    {n > 0 && (
                      <span className="mono-data text-[10px] font-semibold px-1.5 rounded-full" style={{ background: 'var(--state-danger)', color: '#fff', lineHeight: '15px' }}>
                        {n > 99 ? '99+' : n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {tab === 'messages' ? (
              <>
                <div className="px-3 pb-2 shrink-0">
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search conversations"
                    className="w-full text-[13px] px-3 py-1.5 rounded-[var(--radius-sm)] outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                    style={{ border: '1px solid var(--rule-subtle)', background: 'var(--surface-base)', color: 'var(--ink-primary)' }}
                  />
                </div>
                <div className="flex-1 overflow-y-auto" style={{ borderTop: '1px solid var(--rule-subtle)' }}>
                  {convs === null ? (
                    <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
                  ) : visibleConvs.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{convs.length ? 'No matches' : 'No conversations yet'}</p>
                      {!convs.length && (
                        <button onClick={() => setComposing(true)} className="text-xs mt-2 hover:underline" style={{ color: 'var(--ink-secondary)' }}>
                          Start one →
                        </button>
                      )}
                    </div>
                  ) : visibleConvs.map(c => {
                    const on = c.id === selectedId;
                    return (
                      <button
                        key={c.id}
                        onClick={() => go({ c: c.id })}
                        className="ledger-row w-full text-left px-4 py-2.5 flex items-center gap-3"
                        style={on ? { background: 'var(--selection-bg)' } : undefined}
                      >
                        <Avatar name={c.display_name} size={32} group={c.is_group ? c.members.length : undefined} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[13px] truncate" style={{ fontWeight: c.unread_count ? 600 : 500, color: 'var(--ink-primary)' }}>
                              {c.display_name}
                            </p>
                            <span className="mono-data text-[10px] shrink-0" style={{ color: 'var(--ink-faint)' }}>
                              {relativeTime(c.last_message?.created_at ?? c.last_message_at)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] truncate" style={{ color: c.unread_count ? 'var(--ink-secondary)' : 'var(--ink-faint)' }}>
                              {c.last_message
                                ? `${c.last_message.sender_id === user?.id ? 'You' : (c.last_message.sender_name?.split(' ')[0] ?? '')}: ${c.last_message.body}`
                                : 'No messages yet'}
                            </p>
                            {c.unread_count > 0 && (
                              <span className="mono-data text-[10px] font-semibold px-1.5 rounded-full shrink-0" style={{ background: 'var(--state-info)', color: '#fff', lineHeight: '15px' }}>
                                {c.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-4 py-4 text-[12px] leading-relaxed" style={{ color: 'var(--ink-faint)', borderTop: '1px solid var(--rule-subtle)' }}>
                Updates on your grants, completed and assigned tasks, invitations, join requests and messages.
              </div>
            )}
          </div>

          {/* Right pane */}
          <div className={`flex-1 min-w-0 ${tab === 'messages' && !selected ? 'hidden lg:flex' : 'flex'} flex-col`}>
            {tab === 'notifications' ? (
              <>
                <div className="lg:hidden px-4 py-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                  <GhostButton onClick={() => go({ tab: null })}>← Messages</GhostButton>
                </div>
                <NotificationsPane />
              </>
            ) : selected ? (
              <>
                <div className="lg:hidden px-4 py-2" style={{ borderBottom: '1px solid var(--rule-subtle)' }}>
                  <GhostButton onClick={() => go({ c: null })}>← All conversations</GhostButton>
                </div>
                <Thread
                  key={selected.id}
                  conversation={selected}
                  currentUserId={user?.id ?? null}
                  onChanged={refreshAll}
                  onLeft={() => { go({ c: null }); refreshAll(); }}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                    {selectedId && convs ? 'Conversation not found' : 'Select a conversation'}
                  </p>
                  <button onClick={() => setComposing(true)} className="text-xs mt-2 hover:underline" style={{ color: 'var(--ink-secondary)' }}>
                    or start a new one →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {composing && (
        <PeoplePicker
          title="New message"
          confirmLabel="Start conversation"
          allowGroupName
          allowMessage
          onClose={() => setComposing(false)}
          onConfirm={async (ids, groupName, body) => {
            try {
              const r = await messagesApi.createConversation({ member_ids: ids, title: groupName || undefined, body: body || undefined });
              setComposing(false);
              loadConvs();
              go({ tab: null, c: r.data.id });
            } catch (e: any) {
              toast.error(e?.response?.data?.detail ?? 'Could not start the conversation');
            }
          }}
        />
      )}
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInner />
    </Suspense>
  );
}
