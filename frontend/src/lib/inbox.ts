'use client';
import { useCallback, useEffect, useState } from 'react';
import { messages, notifications } from '@/lib/api';

export const INBOX_CHANGED = 'inbox-changed';

export function notifyInboxChanged() {
  window.dispatchEvent(new CustomEvent(INBOX_CHANGED));
}

export function onInboxChanged(handler: () => void) {
  window.addEventListener(INBOX_CHANGED, handler);
  return () => window.removeEventListener(INBOX_CHANGED, handler);
}

export interface InboxCounts {
  messages: number;
  notifications: number;
}

const POLL_MS = 30_000;

/** Unread message + notification counts, polled while the tab is visible. */
export function useInboxCounts(): InboxCounts & { refresh: () => void } {
  const [counts, setCounts] = useState<InboxCounts>({ messages: 0, notifications: 0 });

  const refresh = useCallback(() => {
    Promise.all([
      messages.unreadCount().then(r => r.data?.unread ?? 0).catch(() => 0),
      notifications.unreadCount().then(r => r.data?.unread ?? 0).catch(() => 0),
    ]).then(([m, n]) => setCounts({ messages: m, notifications: n }));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const unsub = onInboxChanged(refresh);
    return () => { window.clearInterval(id); unsub(); };
  }, [refresh]);

  return { ...counts, refresh };
}

export interface NotificationItem {
  id: string;
  notification_type: string;
  entity_type: string | null;
  entity_id: string | null;
  message: string;
  is_read: boolean;
  actor_id: string | null;
  actor_name: string | null;
  link: string | null;
  created_at: string | null;
}

export interface Person { id: string; name: string; email?: string | null }

export interface ConversationItem {
  id: string;
  title: string | null;
  is_group: boolean;
  display_name: string;
  members: Person[];
  last_message_at: string | null;
  last_message: { body: string; sender_id: string | null; sender_name: string | null; created_at: string | null } | null;
  unread_count: number;
}

export interface MessageItem {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string | null;
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

export function avatarColor(name?: string | null): string {
  return `hsl(${((name || '?').charCodeAt(0) * 47) % 360} 55% 55%)`;
}

export const NOTIFICATION_LABEL: Record<string, string> = {
  new_message: 'Message',
  task_completed: 'Task done',
  task_assigned: 'Task',
  task_due_soon: 'Due soon',
  task_overdue: 'Overdue',
  grant_invitation: 'Invitation',
  org_invitation: 'Invitation',
  org_join_request: 'Join request',
  comment_mention: 'Mention',
  grant_status_changed: 'Update',
  grant_external_deadline: 'Deadline',
  grant_internal_deadline: 'Deadline',
  submission_deadline_tomorrow: 'Deadline',
  high_fit_opportunity: 'Opportunity',
  new_opportunity: 'Opportunity',
  opportunity_page_updated: 'Update',
  finance_overspend_warning: 'Finance',
  finance_overspend_critical: 'Finance',
  fund_request_pending: 'Finance',
};
