'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { messages as messagesApi, notifications as notificationsApi } from '@/lib/api';
import {
  useInboxCounts, notifyInboxChanged, relativeTime, initials, avatarColor,
  NOTIFICATION_LABEL, type NotificationItem, type ConversationItem,
} from '@/lib/inbox';

type Panel = 'messages' | 'notifications' | null;

function IconButton({
  label, count, active, onClick, children,
}: { label: string; count: number; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count ? `${label} (${count} unread)` : label}
      title={label}
      className="relative flex items-center gap-2 px-3 h-8 rounded-[var(--radius-sm)] transition-colors"
      style={{
        border: '1px solid var(--rule-subtle)',
        background: active ? 'var(--selection-bg)' : 'var(--surface-raised)',
        color: 'var(--ink-secondary)',
        fontSize: '12px',
      }}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
      {count > 0 && (
        <span
          className="mono-data text-[10px] font-semibold px-1.5 rounded-full"
          style={{ background: 'var(--state-danger)', color: '#fff', lineHeight: '16px', minWidth: 18, textAlign: 'center' }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

export default function InboxWidget() {
  const router = useRouter();
  const counts = useInboxCounts();
  const [open, setOpen] = useState<Panel>(null);
  const [notes, setNotes] = useState<NotificationItem[] | null>(null);
  const [convs, setConvs] = useState<ConversationItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback((panel: Panel) => {
    if (panel === 'notifications') {
      notificationsApi.list({ limit: 8 }).then(r => setNotes(r.data)).catch(() => setNotes([]));
    } else if (panel === 'messages') {
      messagesApi.conversations().then(r => setConvs((r.data as ConversationItem[]).slice(0, 6))).catch(() => setConvs([]));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load(open);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, load]);

  const toggle = (p: Panel) => setOpen(o => (o === p ? null : p));

  const openNotification = async (n: NotificationItem) => {
    if (!n.is_read) {
      await notificationsApi.markRead(n.id).catch(() => null);
      notifyInboxChanged();
    }
    setOpen(null);
    router.push(n.link || '/messages?tab=notifications');
  };

  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => null);
    setNotes(ns => ns?.map(n => ({ ...n, is_read: true })) ?? ns);
    notifyInboxChanged();
  };

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <IconButton label="Messages" count={counts.messages} active={open === 'messages'} onClick={() => toggle('messages')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </IconButton>
      <IconButton label="Notifications" count={counts.notifications} active={open === 'notifications'} onClick={() => toggle('notifications')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </IconButton>

      {open && (
        <div
          className="absolute right-0 top-10 z-40 w-[360px] max-w-[calc(100vw-32px)] overflow-hidden"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--rule-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-floating)',
          }}
        >
          <div
            className="px-4 py-2.5 flex items-center justify-between"
            style={{ background: 'var(--panel-header-bg)', borderBottom: '1px solid var(--panel-header-rule)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--panel-header-text)' }}>
              {open === 'messages' ? 'Messages' : 'Notifications'}
            </span>
            {open === 'notifications' && counts.notifications > 0 && (
              <button onClick={markAll} className="text-[11px] hover:underline" style={{ color: 'var(--ink-muted)' }}>
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {open === 'notifications' && (
              notes === null ? (
                <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
              ) : notes.length === 0 ? (
                <p className="px-4 py-8 text-sm text-center" style={{ color: 'var(--ink-muted)' }}>You&apos;re all caught up</p>
              ) : notes.map(n => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className="ledger-row w-full text-left px-4 py-2.5 flex items-start gap-2.5"
                >
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: n.is_read ? 'transparent' : 'var(--state-info)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug line-clamp-2" style={{ color: n.is_read ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>
                      {n.message}
                    </p>
                    <p className="mono-data text-[10px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                      {[NOTIFICATION_LABEL[n.notification_type] ?? 'Update', relativeTime(n.created_at)].filter(Boolean).join('  ·  ')}
                    </p>
                  </div>
                </button>
              ))
            )}

            {open === 'messages' && (
              convs === null ? (
                <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</p>
              ) : convs.length === 0 ? (
                <p className="px-4 py-8 text-sm text-center" style={{ color: 'var(--ink-muted)' }}>No conversations yet</p>
              ) : convs.map(c => (
                <Link
                  key={c.id}
                  href={`/messages?c=${c.id}`}
                  onClick={() => setOpen(null)}
                  className="ledger-row px-4 py-2.5 flex items-center gap-2.5"
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                    style={{ background: c.is_group ? 'var(--ink-muted)' : avatarColor(c.display_name) }}
                  >
                    {c.is_group ? c.members.length : initials(c.display_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] truncate" style={{ fontWeight: c.unread_count ? 600 : 500, color: 'var(--ink-primary)' }}>
                        {c.display_name}
                      </p>
                      <span className="mono-data text-[10px] shrink-0" style={{ color: 'var(--ink-faint)' }}>
                        {relativeTime(c.last_message?.created_at ?? c.last_message_at)}
                      </span>
                    </div>
                    <p className="text-[12px] truncate" style={{ color: c.unread_count ? 'var(--ink-secondary)' : 'var(--ink-faint)' }}>
                      {c.last_message ? `${c.last_message.sender_name ? c.last_message.sender_name.split(' ')[0] + ': ' : ''}${c.last_message.body}` : 'No messages yet'}
                    </p>
                  </div>
                  {c.unread_count > 0 && (
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--state-info)' }} />
                  )}
                </Link>
              ))
            )}
          </div>

          <Link
            href={open === 'messages' ? '/messages' : '/messages?tab=notifications'}
            onClick={() => setOpen(null)}
            className="block px-4 py-2.5 text-[12px] text-center transition-colors hover:bg-[var(--selection-bg)]"
            style={{ borderTop: '1px solid var(--rule-subtle)', color: 'var(--ink-muted)' }}
          >
            {open === 'messages' ? 'Open messages →' : 'View all notifications →'}
          </Link>
        </div>
      )}
    </div>
  );
}
