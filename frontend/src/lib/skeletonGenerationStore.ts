/**
 * Module-level store for tracking in-progress skeleton generation requests.
 *
 * Two persistence layers:
 *  1. In-memory Map  — survives SPA navigation (axios requests are not cancelled by Next.js routing)
 *  2. localStorage   — survives page refresh (used to trigger polling on remount)
 *
 * The localStorage entry is written when generation starts and cleared when it resolves or fails.
 * If the page is refreshed mid-generation, the HTTP request is killed but the localStorage flag
 * remains. The GrantEditor reads this flag on mount and falls back to polling /writing/status.
 *
 * A "watching" set tracks which grant IDs currently have a GrantEditor component mounted.
 * This lets the background promise handler decide whether to show a toast (user is elsewhere)
 * or stay silent (a component is already handling the state update).
 */

type SkeletonResult = Record<string, unknown>;

interface GenerationEntry {
  promise: Promise<SkeletonResult>;
  startedAt: number;
}

// Max age (ms) after which a stale localStorage flag is ignored (10 minutes).
const MAX_STALE_MS = 10 * 60 * 1000;

const inMemory = new Map<string, GenerationEntry>();
const watching = new Set<string>();

function lsKey(grantId: string): string {
  return `skeleton_gen_${grantId}`;
}

/** Register a generation request. Call this before firing the network request. */
export function startGeneration(grantId: string, promise: Promise<SkeletonResult>): void {
  const startedAt = Date.now();
  inMemory.set(grantId, { promise, startedAt });
  try {
    localStorage.setItem(lsKey(grantId), JSON.stringify({ status: 'generating', startedAt }));
  } catch {
    // localStorage may be unavailable (private browsing, etc.)
  }
}

/**
 * Returns the in-flight promise for this grant, or null if none exists.
 * The promise may already be resolved if the network call finished.
 */
export function getInFlight(grantId: string): Promise<SkeletonResult> | null {
  return inMemory.get(grantId)?.promise ?? null;
}

/** Mark generation as complete and clear both stores. */
export function completeGeneration(grantId: string): void {
  inMemory.delete(grantId);
  try {
    localStorage.removeItem(lsKey(grantId));
  } catch {
    // ignore
  }
}

/** Mark generation as failed and clear both stores. */
export function failGeneration(grantId: string): void {
  inMemory.delete(grantId);
  try {
    localStorage.removeItem(lsKey(grantId));
  } catch {
    // ignore
  }
}

/**
 * Returns true if localStorage indicates that generation was started but not yet completed
 * (i.e. the page was refreshed mid-generation). Stale entries older than MAX_STALE_MS are ignored.
 */
export function isMarkedGenerating(grantId: string): boolean {
  // If we already have an in-memory entry, the in-memory path handles it.
  if (inMemory.has(grantId)) return false;
  try {
    const raw = localStorage.getItem(lsKey(grantId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { status: string; startedAt: number };
    if (parsed.status !== 'generating') return false;
    if (Date.now() - parsed.startedAt > MAX_STALE_MS) {
      localStorage.removeItem(lsKey(grantId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Register that a GrantEditor component is currently mounted and watching this grant.
 * This prevents spurious toast notifications when the user is already on the page.
 */
export function setWatching(grantId: string, active: boolean): void {
  if (active) {
    watching.add(grantId);
  } else {
    watching.delete(grantId);
  }
}

/** Returns true if a GrantEditor for this grant is currently mounted. */
export function isBeingWatched(grantId: string): boolean {
  return watching.has(grantId);
}
