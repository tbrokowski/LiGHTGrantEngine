/** Shapes returned by /funders/threads. */
export interface ThreadFunder { id: string; name: string; funder_tier: string | null }

export interface ThreadPost {
  id: string;
  user_id: string | null;
  user_name: string | null;
  content: string;
  created_at: string | null;
}

export interface FunderThread {
  id: string;
  title: string;
  status: 'open' | 'closed';
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  funders: ThreadFunder[];
  post_count: number;
  last_post: { content: string; user_name: string | null; created_at: string | null } | null;
  /** Only on a single thread (GET /funders/threads/{id}). */
  posts?: ThreadPost[];
}

/** "Today", "Yesterday", "3d ago", or a short date. */
export function whenLabel(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) });
}

export const firstName = (name?: string | null) => (name || '').split(/\s+/)[0] || 'Someone';
